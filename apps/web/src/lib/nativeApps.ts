/**
 * Whether the iOS and Android apps can be installed yet.
 *
 * They aren't in either store, so a settings page and a QR code for an app
 * nobody can get only sends people looking for it. The server side (bearer
 * sessions, `auth.exchange`, the native manifest) stays as it is; this hides
 * the admin UI that points at the apps. Flip it when they ship.
 */
export const NATIVE_APPS_RELEASED = false;
