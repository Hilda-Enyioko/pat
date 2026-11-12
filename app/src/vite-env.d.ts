/// <reference types="vite/client" />
declare module "virtual:pwa-register" {
  export function registerSW(options?: { onOfflineReady?: () => void; onNeedRefresh?: () => void }): (reloadPage?: boolean) => Promise<void>;
}
