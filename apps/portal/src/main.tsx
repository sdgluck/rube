import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portalTrpc, portalTrpcClient } from "./trpc.ts";
import PortalApp from "./PortalApp.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <portalTrpc.Provider client={portalTrpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <PortalApp />
      </QueryClientProvider>
    </portalTrpc.Provider>
  </StrictMode>,
);
