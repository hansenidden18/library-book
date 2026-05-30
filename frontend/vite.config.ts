import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// During dev, proxy API/OPDS/covers to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/opds": "http://localhost:8000",
      "/covers": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
