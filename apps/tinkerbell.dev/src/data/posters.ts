/**
 * The posters in the home page's strip.
 *
 * They are the capture harness's demo artwork (harness/posters.ts), written
 * to public/posters by `pnpm screenshots`, so the site shows the same invented
 * titles as its screenshots and never real artwork. This list is read by both
 * sides, so a title added here is a file the harness will produce.
 */

export interface SitePoster {
  slug: string;
  title: string;
  hue: number;
  /** A rating badge drawn over the poster in CSS, the way an overlay would sit. */
  badge?: string;
}

export const SITE_POSTERS: SitePoster[] = [
  { slug: "salt-horizon", title: "The Salt Horizon", hue: 198 },
  { slug: "paper-lighthouse", title: "Paper Lighthouse", hue: 28, badge: "IMDb 8.1" },
  { slug: "neon-cartographer", title: "Neon Cartographer", hue: 268 },
  { slug: "glass-orchard", title: "The Glass Orchard", hue: 150, badge: "4K" },
  { slug: "velvet-static", title: "Velvet Static", hue: 322 },
  { slug: "driftwood-county", title: "Driftwood County", hue: 175 },
  { slug: "hollow-mercury", title: "Hollow Mercury", hue: 12, badge: "RT 94%" },
];
