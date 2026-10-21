import { createContext, useContext } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@rube/trpc";

export type UserDetailData = inferRouterOutputs<AppRouter>["users"]["get"];

export interface UserContextValue {
  userId: number;
  detail: UserDetailData;
  /** Re-read the user after a change on the Plex side. */
  refresh: () => void;
}

const Ctx = createContext<UserContextValue | null>(null);

export const UserProvider = Ctx.Provider;

/**
 * The user the tab is a tab *of*.
 *
 * Through context rather than a query per tab: the layout has already fetched
 * the user and their live share state to render the header, and a tab
 * refetching it would show a loading state under a header that is plainly
 * already loaded.
 */
export function useUserDetail(): UserContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUserDetail must be used inside the user detail layout");
  return ctx;
}
