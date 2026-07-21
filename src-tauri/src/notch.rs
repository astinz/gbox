use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use tauri::AppHandle;

pub const COMPACT_WIDTH: f64 = 188.0;
pub const COMPACT_HEIGHT: f64 = 38.0;
pub const EXPANDED_WIDTH: f64 = 640.0;
pub const EXPANDED_HEIGHT: f64 = 190.0;

pub fn presentation_size(expanded: bool) -> (f64, f64) {
    if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (COMPACT_WIDTH, COMPACT_HEIGHT)
    }
}

#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle, visible: bool) -> Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let window = if let Some(window) = app.get_webview_window("notch") {
        window
    } else {
        WebviewWindowBuilder::new(
            app,
            "notch",
            WebviewUrl::App("index.html?surface=notch".into()),
        )
        .title("gBox observation notch")
        .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .visible(false)
        .build()?
    };
    configure_native_panel(&window)?;
    position(&window, false, false)?;
    if visible {
        window.show()?;
    }
    start_hover_monitor(app.clone());
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn setup(_app: &AppHandle, _visible: bool) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn set_visible(app: &AppHandle, visible: bool) -> Result<()> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("notch") {
        if visible {
            position(&window, false, false)?;
            window.show()?;
        } else {
            window.hide()?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_visible(_app: &AppHandle, _visible: bool) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn set_presentation(app: &AppHandle, expanded: bool) -> Result<()> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("notch") {
        position(&window, expanded, true)?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_presentation(_app: &AppHandle, _expanded: bool) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn position(window: &tauri::WebviewWindow, expanded: bool, animated: bool) -> Result<()> {
    position_in_camera_area(window, expanded, animated)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_native_panel(window: &tauri::WebviewWindow) -> Result<()> {
    use objc2_app_kit::{NSMainMenuWindowLevel, NSWindow, NSWindowCollectionBehavior};

    let native_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || unsafe {
        let panel = &*(native_window as *const NSWindow);
        panel.setMovable(false);
        panel.setLevel(NSMainMenuWindowLevel + 3);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
    })?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_in_camera_area(
    window: &tauri::WebviewWindow,
    expanded: bool,
    animated: bool,
) -> Result<()> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let native_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || unsafe {
        let Some(marker) = MainThreadMarker::new() else {
            return;
        };
        let Some(screen) = NSScreen::mainScreen(marker) else {
            return;
        };
        let screen_frame = screen.frame();
        let (width, height) = if expanded {
            presentation_size(true)
        } else {
            compact_camera_size(&screen, screen_frame.size.width)
        };
        let origin = NSPoint::new(
            screen_frame.origin.x + (screen_frame.size.width - width) / 2.0,
            screen_frame.origin.y + screen_frame.size.height - height,
        );
        let panel = &*(native_window as *const NSWindow);
        let frame = NSRect::new(origin, NSSize::new(width, height));
        if animated {
            panel.setFrame_display_animate(frame, true, true);
        } else {
            panel.setFrame_display(frame, true);
        }
    })?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn compact_camera_size(screen: &objc2_app_kit::NSScreen, screen_width: f64) -> (f64, f64) {
    let left = screen.auxiliaryTopLeftArea().size.width;
    let right = screen.auxiliaryTopRightArea().size.width;
    let detected_width = screen_width - left - right;
    let width = if (120.0..=320.0).contains(&detected_width) {
        detected_width + 12.0
    } else {
        COMPACT_WIDTH
    };
    let detected_height = screen.safeAreaInsets().top;
    let height = if (24.0..=64.0).contains(&detected_height) {
        detected_height + 4.0
    } else {
        COMPACT_HEIGHT
    };
    (width, height)
}

#[cfg(target_os = "macos")]
fn start_hover_monitor(app: AppHandle) {
    use tauri::Manager;

    let last_hovered = Arc::new(AtomicBool::new(false));
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(60));
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window("notch") else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                emit_hover_change(&app, &last_hovered, false);
                continue;
            }
            let Ok(native_window) = window.ns_window() else {
                continue;
            };
            let native_window = native_window as usize;
            let app_for_event = app.clone();
            let last_for_event = last_hovered.clone();
            let _ = window.run_on_main_thread(move || unsafe {
                use objc2_app_kit::{NSEvent, NSWindow};

                let panel = &*(native_window as *const NSWindow);
                let frame = panel.frame();
                let pointer = NSEvent::mouseLocation();
                let expanded = frame.size.height > 80.0;
                let hovered = hover_region_contains(
                    frame.origin.x,
                    frame.origin.y,
                    frame.size.width,
                    frame.size.height,
                    pointer.x,
                    pointer.y,
                    expanded,
                );
                emit_hover_change(&app_for_event, &last_for_event, hovered);
            });
        }
    });
}

#[cfg(target_os = "macos")]
fn emit_hover_change(app: &AppHandle, last_hovered: &AtomicBool, hovered: bool) {
    use tauri::Emitter;

    if last_hovered.swap(hovered, Ordering::Relaxed) != hovered {
        let _ = app.emit("gbox://notch-hover-changed", hovered);
    }
}

fn hover_region_contains(
    frame_x: f64,
    frame_y: f64,
    frame_width: f64,
    frame_height: f64,
    pointer_x: f64,
    pointer_y: f64,
    expanded: bool,
) -> bool {
    let horizontal_margin = if expanded { 0.0 } else { 16.0 };
    let lower_margin = if expanded { 0.0 } else { 14.0 };
    pointer_x >= frame_x - horizontal_margin
        && pointer_x <= frame_x + frame_width + horizontal_margin
        && pointer_y >= frame_y - lower_margin
        && pointer_y <= frame_y + frame_height
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_and_expanded_sizes_are_stable() {
        assert_eq!(presentation_size(false), (188.0, 38.0));
        assert_eq!(presentation_size(true), (640.0, 190.0));
    }

    #[test]
    fn compact_hover_region_reaches_below_and_beside_camera_cutout() {
        assert!(hover_region_contains(
            500.0, 900.0, 188.0, 38.0, 495.0, 890.0, false
        ));
        assert!(!hover_region_contains(
            500.0, 900.0, 188.0, 38.0, 480.0, 880.0, false
        ));
        assert!(hover_region_contains(
            300.0, 748.0, 640.0, 190.0, 400.0, 800.0, true
        ));
    }
}
