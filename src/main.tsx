import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { debug } from "./map/engine.ts";
import "./style.css";

Object.assign(window, { hloverview: debug });   // what the tests read
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
