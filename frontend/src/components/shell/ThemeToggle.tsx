import { useState } from "react";
import { Button } from "../../ui/button/button";
import { applyTheme, saveTheme, THEMES, type ThemeSetting } from "../../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeSetting>(() => {
    try {
      const raw = window.localStorage.getItem("haggle-theme");
      if (!raw) return "system";
      const parsed = JSON.parse(raw);
      if (parsed === "system" || parsed === "light" || parsed === "dark") return parsed;
      return "system";
    } catch {
      return "system";
    }
  });

  const handleSelect = (next: ThemeSetting) => {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  return (
    <div className="themeToggle" role="group" aria-label="Theme">
      {THEMES.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="sm"
          pressed={theme === option.value}
          onClick={() => handleSelect(option.value)}
          aria-pressed={theme === option.value}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
