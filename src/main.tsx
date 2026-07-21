import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import NotchApp from "./NotchApp";
import "./index.css";
import { applyTheme, initializeTheme, isTheme, THEME_STORAGE_KEY } from "./lib/theme";

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.dataset.surface = surface ?? "main";
initializeTheme();

window.addEventListener("storage", (event) => {
  if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) applyTheme(event.newValue);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {surface === "notch" ? <NotchApp /> : <App />}
  </React.StrictMode>,
);
