import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./frontend", import.meta.url)) } },
  clearScreen: false,
  build: { outDir: "../dist", emptyOutDir: true },
  server: { watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/graphify-out/**"] } },
});
