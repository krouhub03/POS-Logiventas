import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  fontSizePx: number;
  setFontSizePx: (px: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("pos_theme") as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
    return "light"; // Default claro
  });

  const [fontSizePx, setFontSizePxState] = useState<number>(() => {
    const saved = localStorage.getItem("pos_font_size_px");
    const num = Number(saved);
    if (!isNaN(num) && num >= 10 && num <= 24) {
      return num;
    }
    // Migración retrocompatible si venía de pos_font_size
    const legacy = localStorage.getItem("pos_font_size");
    if (legacy === "small") return 12.5;
    if (legacy === "large") return 15.5;
    if (legacy === "xlarge") return 17;
    return 14;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("pos_theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${fontSizePx}px`;
    localStorage.setItem("pos_font_size_px", String(fontSizePx));
  }, [fontSizePx]);

  // Asegurar que el body zoom esté limpio (100% normal)
  useEffect(() => {
    localStorage.removeItem("pos_ui_scale");
    if (document.body) {
      document.body.style.zoom = "1";
    }
    document.documentElement.removeAttribute("data-ui-scale");
  }, []);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
  };

  const setFontSizePx = (px: number) => {
    const clamped = Math.max(10, Math.min(24, Math.round(px * 10) / 10));
    setFontSizePxState(clamped);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        fontSizePx,
        setFontSizePx,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme debe usarse dentro de un ThemeProvider");
  }
  return ctx;
}
