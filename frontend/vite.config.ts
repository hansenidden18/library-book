import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// During dev, proxy API/OPDS/covers to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      // Only precache the app shell/assets; never the API, OPDS, covers, or files.
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2}"],
        navigateFallbackDenylist: [/^\/api/, /^\/opds/, /^\/covers/],
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
      manifest: {
        name: "library-book",
        short_name: "library",
        description: "Your e-book and paper reading library",
        theme_color: "#0b0d12",
        background_color: "#0b0d12",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
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
