import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ModalProvider } from "./contexts/ModalContext";
import { UpdaterProvider } from "./contexts/UpdaterContext";

// Deshabilitar menú contextual nativo del navegador (clic derecho / menú de sistema)
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  return false;
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <ModalProvider>
        <UpdaterProvider>
          <App />
        </UpdaterProvider>
      </ModalProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
