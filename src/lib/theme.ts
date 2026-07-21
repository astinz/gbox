export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gbox-theme";

type ThemePreference = {
  storedTheme?: string | null;
  prefersDark?: boolean;
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(preference: ThemePreference = {}): Theme {
  if (isTheme(preference.storedTheme)) return preference.storedTheme;
  return preference.prefersDark ? "dark" : "light";
}

export function readThemePreference(): Theme {
  let storedTheme: string | null = null;
  try {
    storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened webviews; the system preference remains usable.
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return resolveTheme({ storedTheme, prefersDark });
}

export function appliedTheme(root: HTMLElement = document.documentElement): Theme {
  return isTheme(root.dataset.theme) ? root.dataset.theme : readThemePreference();
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const themeColor = root.ownerDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", theme === "dark" ? "#000000" : "#f7f5f0");
}

export function initializeTheme(): Theme {
  const theme = readThemePreference();
  applyTheme(theme);
  return theme;
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies for this session when persistence is unavailable.
  }
}
