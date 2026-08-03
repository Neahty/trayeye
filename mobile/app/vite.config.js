import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Приложение раздаётся с боевого сервера по адресу /app/ (Caddy), поэтому все
  // ссылки на ассеты должны быть с этим префиксом.
  base: "/app/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false
  }
});
