import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { setupPwa } from "./lib/pwa";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import { armIntro, installStage } from "./lib/stage";

installStage();
armIntro();

setupPwa();

createRoot(
  document.getElementById("root")!
).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
