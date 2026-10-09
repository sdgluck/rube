import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portalTrpc, portalTrpcClient } from "./trpc.ts";
import PortalApp from "./PortalApp.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import NativeShell from "./components/NativeShell.tsx";
import { bootNative, setStatusBarTheme } from "@tinkerbell/native-client";
import "./fonts.css";
import "./tokens.css";
import "./portal.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// A no-op in a browser; in the native app it loads the stored server and
// session before the first request. Not awaited at the top level, which the
// build target doesn't allow.
void bootNative("portal").finally(render);

// The portal follows the phone's appearance (tokens.css), so the status bar's
// icons follow it too, and keep following it.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const syncStatusBar = () => setStatusBarTheme(dark.matches ? "dark" : "light");
syncStatusBar();
dark.addEventListener("change", syncStatusBar);

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <portalTrpc.Provider client={portalTrpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* The portal is one screen, so an uncaught render error is the
            whole product rather than one page of it. */}
          <ErrorBoundary>
            <NativeShell>
              <PortalApp />
            </NativeShell>
          </ErrorBoundary>
        </QueryClientProvider>
      </portalTrpc.Provider>
    </StrictMode>,
  );
}
