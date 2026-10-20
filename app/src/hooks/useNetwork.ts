import { useEffect, useState } from "react";
import { RPC_URL } from "../config";
import { probeReachable } from "../lib/network";

const PROBE_EVERY_MS = 20000;

/**
 * Whether the device can actually reach the network. navigator.onLine only
 * knows about the link (it stays true on Wi-Fi with no internet), so while it
 * reports online we also probe the RPC endpoint and treat a failure as offline.
 */
export function useNetwork() {
  const [reachable, setReachable] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const check = async () => {
      window.clearTimeout(timer);
      const ok = navigator.onLine && (await probeReachable(RPC_URL));
      if (cancelled) return;
      setReachable(ok);
      if (document.visibilityState === "visible") timer = window.setTimeout(check, PROBE_EVERY_MS);
    };

    const handleOffline = () => {
      window.clearTimeout(timer);
      setReachable(false);
    };
    const handleOnline = () => void check();
    const handleVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);
    void check();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  return reachable;
}
