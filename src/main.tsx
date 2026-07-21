import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import NotchApp from "./NotchApp";
import "./index.css";

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.dataset.surface = surface ?? "main";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {surface === "notch" ? <NotchApp /> : <App />}
  </React.StrictMode>,
);
