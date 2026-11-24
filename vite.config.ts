import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ base: "./", plugins: [react()] });   // relative, so the page works under any path, as on GitHub Pages
