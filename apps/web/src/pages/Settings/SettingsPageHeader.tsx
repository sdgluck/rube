import type { ReactNode } from "react";
import { PageActions } from "#layout/AppBar";

/**
 * Every settings pane's identity, without a visible heading: the app bar's
 * breadcrumb already reads "Settings / Plex", so a title here only repeated it
 * and pushed the first real control down the fold. The name survives for
 * assistive tech, and the optional `meta` (a version, a count) is portalled up
 * into the bar beside the breadcrumb.
 *
 * There is deliberately no description slot — the controls say what they do.
 */
export default function SettingsPageHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <>
      <h2 className="sr-only">{title}</h2>
      {meta != null && <PageActions slot="meta">{meta}</PageActions>}
    </>
  );
}
