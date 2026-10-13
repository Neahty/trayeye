import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В разработке API (server/, порт 4100) проксируется, в проде web/dist раздаёт сам сервер.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4100" }
  }
});
