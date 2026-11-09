import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // The dev enroll token is a shared secret. Anything in VITE_* ships in the bundle,
  // so a production build with it set would publish the secret.
  if (command === "build" && mode === "production" && env.VITE_DEV_ENROLL_TOKEN) {
    throw new Error("VITE_DEV_ENROLL_TOKEN is set. It is for local testing only; unset it before a production build.");
  }

  // RPC and gateway responses must never come from the service worker: the offline
  // guard decides what happens without a network, not a stale cache.
  const networkOnlyOrigins = [env.VITE_RPC_URL, env.VITE_GATEWAY_URL]
    .filter((u): u is string => Boolean(u))
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return null;
      }
    })
    .filter((o): o is string => Boolean(o));

  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({ include: ["buffer"], globals: { Buffer: true } }), // web3.js needs Buffer
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.png", "apple-touch-icon.png"],
        manifest: {
          id: "/",
          name: "PAT",
          short_name: "PAT",
          description: "Reserve while connected. Spend while disconnected. Settle when reconnected.",
          theme_color: "#f5f4ef",
          background_color: "#f5f4ef",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // SPA fallback: deep links (/ledger, /guide#ussd) open offline from the cached shell.
          navigateFallback: "/index.html",
          // web3.js makes the bundle big; the default 2 MiB limit silently skips precaching it
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            ...networkOnlyOrigins.map((origin) => ({
              urlPattern: ({ url }: { url: URL }) => url.origin === origin,
              handler: "NetworkOnly" as const,
            })),
            {
              // Any Solana JSON-RPC endpoint, including fallbacks not named in env.
              urlPattern: ({ url }: { url: URL }) => /solana|helius|rpc/i.test(url.hostname),
              handler: "NetworkOnly" as const,
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: { host: true },
  };
});
