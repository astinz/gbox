use std::{collections::HashMap, sync::Arc};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

use crate::{
    domain::{PendingAction, ResolveActionInput, ResolveActionResult},
    store::Store,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResponse {
    pub decision: String,
    pub reason: Option<String>,
    pub updated_input: Option<Value>,
}

struct GateResolution {
    decision: String,
    reason: Option<String>,
    approval_token: Option<String>,
}

pub struct ActionGate {
    app: AppHandle,
    store: Arc<Store>,
    pending: Mutex<HashMap<String, oneshot::Sender<GateResolution>>>,
}

impl ActionGate {
    pub fn new(app: AppHandle, store: Arc<Store>) -> Arc<Self> {
        Arc::new(Self {
            app,
            store,
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub async fn request(&self, action: PendingAction, original_input: Value) -> GateResponse {
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(action.id.clone(), sender);
        let _ = self.app.emit("gbox://approval-requested", &action);
        self.show_approval_window();

        match timeout(Duration::from_secs(300), receiver).await {
            Ok(Ok(resolution)) if resolution.decision == "approve" => {
                let mut updated_input = original_input;
                if let Some(object) = updated_input.as_object_mut() {
                    object.insert(
                        "approval_token".to_owned(),
                        Value::String(resolution.approval_token.unwrap_or_default()),
                    );
                    object.insert(
                        "gbox_action_id".to_owned(),
                        Value::String(action.id.clone()),
                    );
                }
                GateResponse {
                    decision: "allow".to_owned(),
                    reason: resolution.reason,
                    updated_input: Some(updated_input),
                }
            }
            Ok(Ok(resolution)) => GateResponse {
                decision: "deny".to_owned(),
                reason: Some(
                    resolution
                        .reason
                        .unwrap_or_else(|| "The user denied this action in gBox.".to_owned()),
                ),
                updated_input: None,
            },
            _ => {
                self.pending.lock().await.remove(&action.id);
                let reason = "gBox approval expired after five minutes.";
                let _ = self.store.expire_action(&action.id, reason);
                self.hide_approval_window_if_idle().await;
                GateResponse {
                    decision: "deny".to_owned(),
                    reason: Some(reason.to_owned()),
                    updated_input: None,
                }
            }
        }
    }

    pub async fn resolve(&self, input: ResolveActionInput) -> Result<ResolveActionResult> {
        let (action, _decision, approval_token) = self.store.resolve_action(
            &input.action_id,
            &input.decision,
            input.reason.as_deref(),
        )?;
        let sender = self
            .pending
            .lock()
            .await
            .remove(&input.action_id)
            .ok_or_else(|| anyhow!("pending approval was not found"))?;
        let normalized = if input.decision.eq_ignore_ascii_case("approve")
            || input.decision.eq_ignore_ascii_case("approved")
        {
            "approve"
        } else {
            "deny"
        };
        let _ = sender.send(GateResolution {
            decision: normalized.to_owned(),
            reason: input.reason,
            approval_token: approval_token.clone(),
        });
        self.hide_approval_window_if_idle().await;
        if let Ok(receipts) = self.store.list_receipts() {
            if let Some(receipt) = receipts.first() {
                let _ = self.app.emit("gbox://receipt-created", receipt);
            }
        }
        Ok(ResolveActionResult {
            action,
            approval_token,
        })
    }

    pub async fn has_pending(&self) -> bool {
        !self.pending.lock().await.is_empty()
    }

    fn show_approval_window(&self) {
        if let Some(window) = self.app.get_webview_window("approval") {
            let _ = window.set_always_on_top(true);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    async fn hide_approval_window_if_idle(&self) {
        if self.pending.lock().await.is_empty() {
            if let Some(window) = self.app.get_webview_window("approval") {
                let _ = window.hide();
            }
        }
    }
}
