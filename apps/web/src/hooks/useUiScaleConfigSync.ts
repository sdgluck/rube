import { useEffect } from "react";
import { isUiScale } from "@rube/contracts";
import { trpc } from "#/trpc";
import { hasStoredUiScale, setUiScale } from "#/ui-scale";

/**
 * Adopts the server's stored interface size on a browser that has never
 * chosen one. One-way and one-shot for the reason `useThemeConfigSync` gives.
 */
export default function useUiScaleConfigSync(): void {
  const { data } = trpc.config.get.useQuery(undefined, { staleTime: Infinity });
  const stored = data?.ui_scale;

  useEffect(() => {
    if (stored === undefined || hasStoredUiScale() || !isUiScale(stored)) return;
    setUiScale(stored, { persist: false });
  }, [stored]);
}
