import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В разработке API (server/, порт 4100) проксируется, в проде web/dist раздаёт сам сервер.
// VITE_BASE - префикс за прокси (например /trayeye/), должен совпадать с BASE_PATH сервера.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4100" }
  }
});
