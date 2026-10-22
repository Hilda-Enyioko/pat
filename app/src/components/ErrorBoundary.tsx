import { Component, type ErrorInfo, type ReactNode } from "react";

/** Shows what went wrong instead of a blank page, with a way out of a stale cached build. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PAT crashed:", error, info.componentStack);
  }

  private async resetAndReload() {
    try {
      const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(registrations.map((r) => r.unregister()));
      const keys = (await caches?.keys()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } finally {
      window.location.reload();
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="page flex min-h-svh flex-col justify-center gap-6">
        <h1 className="display-h text-[clamp(40px,9vw,88px)]">
          Something
          <br />
          broke.
        </h1>
        <p className="m-0 max-w-xl text-[17px] leading-relaxed">
          PAT hit an error while loading. Your wallet and offline ledger are untouched. Reloading usually fixes it; if it
          keeps happening, clear the cached app and reload.
        </p>
        <pre className="m-0 max-w-full overflow-auto rounded-[14px] bg-white p-4 font-mono text-xs whitespace-pre-wrap text-red">
          {error.name}: {error.message}
        </pre>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="h-12 cursor-pointer rounded-full border-0 bg-ink px-6 font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="h-12 cursor-pointer rounded-full border border-ink/15 bg-white px-6 font-semibold text-ink"
            onClick={() => void this.resetAndReload()}
          >
            Clear cached app and reload
          </button>
        </div>
      </main>
    );
  }
}
