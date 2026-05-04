export const VERSION = __APP_VERSION__;
export const CHANGELOG = __CHANGELOG__;
export const IS_BETA = VERSION.startsWith("0.") || /-(?:beta|alpha|rc)/.test(VERSION);
