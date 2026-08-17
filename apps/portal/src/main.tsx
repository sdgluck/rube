import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portalTrpc, portalTrpcClient } from "./trpc.ts";
import PortalApp from "./PortalApp.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import "./fonts.css";
import "./tokens.css";
import "./portal.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <portalTrpc.Provider client={portalTrpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* The portal is one screen, so an uncaught render error is the
            whole product rather than one page of it. */}
        <ErrorBoundary>
          <PortalApp />
        </ErrorBoundary>
      </QueryClientProvider>
    </portalTrpc.Provider>
  </StrictMode>,
);
