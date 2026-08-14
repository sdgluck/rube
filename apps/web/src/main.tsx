import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, trpcClient } from "#/trpc";
import { ToastProvider } from "#components/Toast";
import AuthGate from "#/auth/AuthGate";
import App from "#/App";
import "#/styles/fonts.css";
import "#/App.css";

/**
 * Capture mode, for the screenshot harness only.
 *
 * Several queries set their own `refetchInterval` — the sidebar polls running
 * jobs every two seconds — and a refetch landing mid-screenshot repaints the
 * page, so the same route captures differently on different runs. Per-query
 * options beat client defaults, so the only way to hold the page still is to
 * override the resolved options.
 *
 * `VITE_TB_CAPTURE` is never set for a real build, so this whole branch is
 * dead code the bundler drops.
 */
class CaptureQueryClient extends QueryClient {
  // Declared as the base method's own type and cast once: the override is
  // generic-erased, and reproducing react-query's six type parameters here
  // would say nothing the cast doesn't.
  defaultQueryOptions = ((options: never) => ({
    ...QueryClient.prototype.defaultQueryOptions.call(this, options),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // A retry with jitter leaves the page in a different state depending on
    // how the timing fell.
    retry: false,
    staleTime: Infinity,
  })) as QueryClient["defaultQueryOptions"];
}

const Client = import.meta.env.VITE_TB_CAPTURE === "1" ? CaptureQueryClient : QueryClient;

const queryClient = new Client({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            {/* Inside the router and the toast provider: the sign-in screen
                is a route-level swap, not a separate app. */}
            <AuthGate>
              <App />
            </AuthGate>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
