/**
 * Which bottom tab a path belongs to, and where each tab was left.
 *
 * Pure, so it is unit-tested; the BottomNav component keeps the state.
 * Anything not under a pinned tab lives under More — Settings, Rules, every
 * page the admin didn't pin — which is where the More screen links to it from.
 */
export const MORE = "/more";

export function tabFor(pathname: string, tabRoots: string[]): string {
  let best: string | null = null;
  for (const root of tabRoots) {
    if ((pathname === root || pathname.startsWith(`${root}/`)) && root.length > (best?.length ?? 0)) best = root;
  }
  return best ?? MORE;
}

/**
 * What tapping a tab does. Another tab: go back to wherever it was left.
 * The current tab, deep in it: pop to its root. The current tab at its root:
 * scroll to the top. That last pair is how both iOS and Android tab bars
 * behave, and it is the only way out of a deep stack without Back.
 */
export function tabTapAction(input: {
  tapped: string;
  currentTab: string;
  pathname: string;
  remembered: string | undefined;
}): { kind: "navigate"; to: string } | { kind: "scrollTop" } {
  const { tapped, currentTab, pathname, remembered } = input;
  if (tapped !== currentTab) return { kind: "navigate", to: remembered ?? tapped };
  if (pathname !== tapped) return { kind: "navigate", to: tapped };
  return { kind: "scrollTop" };
}
