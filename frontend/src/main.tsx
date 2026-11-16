import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, loadTheme } from "./lib/theme";
import "./design/tokens.css";
import "./styles.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
