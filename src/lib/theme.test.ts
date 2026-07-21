import { afterEach, describe, expect, it } from "vitest";

import {
  applyTheme,
  persistTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("theme preferences", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    document.documentElement.style.removeProperty("color-scheme");
    window.localStorage.clear();
  });

  it("prefers an explicit saved theme over the system appearance", () => {
    expect(resolveTheme({ storedTheme: "light", prefersDark: true })).toBe("light");
    expect(resolveTheme({ storedTheme: "dark", prefersDark: false })).toBe("dark");
  });

  it("uses the system appearance when no valid theme is saved", () => {
    expect(resolveTheme({ storedTheme: null, prefersDark: true })).toBe("dark");
    expect(resolveTheme({ storedTheme: "unknown", prefersDark: false })).toBe("light");
  });

  it("applies the selected theme to the document", () => {
    applyTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("persists an explicit selection", () => {
    persistTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
