import { getPortalIcon } from "../portalIcons.ts";

export interface Branding {
  title?: string;
  icon?: string;
  iconColor?: string;
  backgroundImage?: string;
}

/**
 * The admin's chosen name and icon for their server's portal.
 *
 * The icon colour falls back to the `--plex` token rather than to a literal.
 * It used to be `#e5a00d` typed inline — exactly the kind of hardcoded brand
 * colour the admin app's stylelint forbids, sitting in the one surface end
 * users actually see, where it could not follow the dark scheme.
 */
export default function BrandHeader({ branding, size = 26 }: { branding: Branding; size?: number }) {
  const Icon = getPortalIcon(branding.icon);
  return (
    <span className="brand-head">
      <Icon size={size} color={branding.iconColor?.trim() || "var(--plex)"} />
      <span>{branding.title?.trim() || "Tinkerbell"}</span>
    </span>
  );
}
