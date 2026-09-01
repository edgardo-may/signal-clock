import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      // Redirige /api/sync/* al servidor de sincronización backend
      // El Bearer Token de Consolide NUNCA pasa por Vite ni el navegador
      "/api/sync": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
