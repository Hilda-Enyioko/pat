import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true } }), // web3.js needs Buffer
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PAT",
        short_name: "PAT",
        description: "Reserve while connected. Spend while disconnected. Settle when reconnected.",
        theme_color: "#f5f4ef",
        background_color: "#f5f4ef",
        display: "browser",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        // web3.js makes the bundle big; the default 2 MiB limit silently skips precaching it
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: true },
});
