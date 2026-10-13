import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ModalProvider } from "./contexts/ModalContext";
import { UpdaterProvider } from "./contexts/UpdaterContext";

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
