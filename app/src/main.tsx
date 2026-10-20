import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { registerSW } from "virtual:pwa-register";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import { armIntro, installStage } from "./lib/stage";

installStage();
armIntro();

registerSW({ onOfflineReady: () => window.dispatchEvent(new Event("pat:offline-ready")) });

createRoot(
  document.getElementById("root")!
).render(
  <StrictMode>
    <App />
  </StrictMode>
);
