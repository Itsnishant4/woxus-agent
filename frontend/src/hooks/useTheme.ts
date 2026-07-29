import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "woxus_dark_mode";

function getInitialDark(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored === "true";
  return true;
}

function applyTheme(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}

export function useTheme() {
  const [dark, setDark] = useState(getInitialDark);

  useEffect(() => {
    applyTheme(dark);
    localStorage.setItem(STORAGE_KEY, String(dark));
  }, [dark]);

  const toggle = useCallback(() => setDark((p) => !p), []);

  return { dark, toggle };
}
