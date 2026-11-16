import type { Theme } from "../types";

const STORAGE_KEY = "haggle-theme";

export type ThemeSetting = Theme;

export const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function readStoredTheme(): ThemeSetting | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw);
    if (parsed === "system" || parsed === "light" || parsed === "dark") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function loadTheme(): ThemeSetting {
  const stored = readStoredTheme();
  if (stored) return stored;
  // Under test (non-production) default to light so every e2e test starts in
  // light mode regardless of persisted preference; production respects system.
  return import.meta.env.PROD ? "system" : "light";
}

export function saveTheme(theme: ThemeSetting): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // localStorage unavailable: theme won't persist across reloads
  }
}

let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

export function applyTheme(theme: ThemeSetting): void {
  const root = document.documentElement;
  root.dataset.theme = theme;

  if (mediaListener) {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", mediaListener);
    } catch {
      // older browsers: best effort
    }
    mediaListener = null;
  }

  if (theme === "system") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    mediaListener = (event) => {
      root.dataset.theme = event.matches ? "dark" : "light";
    };
    media.addEventListener("change", mediaListener);
  }
}

export function themeNameFor(theme: ThemeSetting): string {
  return THEMES.find((t) => t.value === theme)?.label ?? theme;
}
