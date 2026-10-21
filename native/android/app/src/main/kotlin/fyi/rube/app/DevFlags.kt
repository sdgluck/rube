// Debug-only switches for the instrumented tests and the dev server — the
// Android spelling of iOS's `-TBDevSignInAs`, `-TBOpenURL` and
// `-TBResetState` launch arguments, passed as intent extras:
//
//   adb shell am start -n fyi.rube.app/.MainActivity \
//     --ez tb.resetState true --es tb.devSignInAs 1 --es tb.openUrl 'rube://connect?…'
//
// In a release build every one of these reads as off, and a connect link's
// `plexTv=` is dropped at parsing: a link naming its own plex.tv would be a
// way to steer sign-in to a fake one.
package fyi.rube.app

import android.content.Intent

object DevFlags {
    val isDebug: Boolean = BuildConfig.DEBUG

    const val RESET_STATE = "tb.resetState"
    const val SIGN_IN_AS = "tb.devSignInAs"
    const val OPEN_URL = "tb.openUrl"

    /**
     * A seeded Plex account id to approve the PIN as, on the dev server's mock
     * plex.tv, without showing its page. Lives for the process, like a launch
     * argument does.
     */
    @Volatile
    var signInAs: String? = null
        private set

    /** Applies an intent's extras; returns a link to open, if it carried one. */
    fun apply(intent: Intent?, app: RubeApplication): String? {
        if (!isDebug || intent == null) return null
        if (intent.getBooleanExtra(RESET_STATE, false)) {
            app.reset()
            signInAs = null
        }
        intent.getStringExtra(SIGN_IN_AS)?.let { signInAs = it.ifEmpty { null } }
        val url = intent.getStringExtra(OPEN_URL)
        // Consumed: a configuration change re-delivers the same intent, and a
        // reset on rotation would sign the tester out mid-test.
        intent.removeExtra(RESET_STATE)
        intent.removeExtra(OPEN_URL)
        return url
    }
}
