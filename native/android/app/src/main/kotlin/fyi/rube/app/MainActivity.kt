// The one activity. It hands links to the router, tells sign-in when the
// person comes back from the Custom Tab, and draws edge to edge.
//
// A FragmentActivity because BiometricPrompt hosts its dialog in a fragment;
// Compose doesn't mind which ComponentActivity it is drawn into.
package fyi.rube.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.key
import androidx.fragment.app.FragmentActivity
import fyi.rube.platform.Links

class MainActivity : FragmentActivity() {
    private val app: RubeApplication get() = application as RubeApplication

    private val presenter = object : SignInPresenter {
        override fun openAuthPage(url: String) = Links.openInTab(this@MainActivity, url)

        override fun bringToFront() {
            startActivity(
                Intent(applicationContext, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val devLink = DevFlags.apply(intent, app)
        setContent {
            val graph = app.graph ?: return@setContent
            key(graph) {
                graph.signIn.presenter = presenter
                RubeRoot(graph)
            }
        }
        if (savedInstanceState == null) openLinks(intent, devLink)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openLinks(intent, DevFlags.apply(intent, app))
    }

    override fun onPause() {
        super.onPause()
        app.graph?.signIn?.onActivityPaused()
    }

    override fun onResume() {
        super.onResume()
        app.graph?.signIn?.onActivityResumed()
    }

    private fun openLinks(intent: Intent?, devLink: String?) {
        val graph = app.graph ?: return
        devLink?.let(graph.links::open)
        if (intent?.action == Intent.ACTION_VIEW) intent.data?.toString()?.let(graph.links::open)
    }
}
