import { setTheme as setNativeTheme } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import {
  appliedTheme,
  applyTheme,
  persistTheme,
  type Theme,
} from "@/lib/theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => appliedTheme());

  useEffect(() => {
    applyTheme(theme);
    if (isTauri()) void setNativeTheme(theme).catch(() => undefined);
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    persistTheme(nextTheme);
    setThemeState(nextTheme);
  }, []);

  return { theme, setTheme };
}
