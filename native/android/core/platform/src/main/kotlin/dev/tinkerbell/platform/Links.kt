// Leaving the app: a page in a Custom Tab, the share sheet, Plex.
//
// Custom Tabs rather than a WebView for anything on the web: plex.tv's sign-in
// in a WebView is a page the app could read the password out of, and the web
// admin wants the browser's own session and password manager.
package dev.tinkerbell.platform

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

object Links {
    fun openInTab(context: Context, url: String) {
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
        } catch (e: ActivityNotFoundException) {
            openExternally(context, url)
        }
    }

    /** Hands the link to whatever claims it — the Plex app for a Plex link, if installed. */
    fun openExternally(context: Context, url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
        }
    }

    fun share(context: Context, text: String, subject: String? = null) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
        }
        context.startActivity(Intent.createChooser(send, subject).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
