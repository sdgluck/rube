export const VERSION = __APP_VERSION__;
export const CHANGELOG = __CHANGELOG__;
/** Short commit the bundle was built from; empty when the build had no git. */
export const GIT_SHA = __GIT_SHA__;
export const IS_BETA = VERSION.startsWith("0.") || /-(?:beta|alpha|rc)/.test(VERSION);
