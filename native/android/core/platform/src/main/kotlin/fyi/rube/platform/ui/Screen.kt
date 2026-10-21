// One screen's frame: a top app bar (back when pushed, the account menu on a
// tab's first screen), a snackbar host, and content that pulls to refresh.
//
// Every screen goes through this so the bar, the insets and the refresh
// gesture behave the same everywhere. The insets are the subtle part: the
// navigation suite's bottom bar already pads for the gesture area, so a
// screen inside it only takes the top and the sides — taking the bottom too
// left a band of empty space above the bar.
@file:OptIn(ExperimentalMaterial3Api::class)

package fyi.rube.platform.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch

enum class Nav { NONE, BACK, CLOSE }

@Composable
fun TbScreen(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    nav: Nav = Nav.NONE,
    onNav: () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    snackbar: SnackbarHostState? = null,
    bottomBar: @Composable () -> Unit = {},
    floatingActionButton: @Composable () -> Unit = {},
    /**
     * Inside the navigation suite (true) or full screen over everything (false).
     * Content is always given zero padding: the frame has already applied it.
     */
    inSuite: Boolean = true,
    onRefresh: (suspend () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    Scaffold(
        modifier = modifier.nestedScroll(scroll.nestedScrollConnection),
        contentWindowInsets = if (inSuite) WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal) else WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = {
                    androidx.compose.foundation.layout.Column {
                        Text(
                            title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.testTag("screen-title").semantics { heading() },
                        )
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    when (nav) {
                        Nav.NONE -> Unit
                        Nav.BACK -> IconButton(onClick = onNav) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                        Nav.CLOSE -> IconButton(onClick = onNav) { Icon(Icons.Filled.Close, contentDescription = "Close") }
                    }
                },
                actions = actions,
                scrollBehavior = scroll,
            )
        },
        snackbarHost = { snackbar?.let { SnackbarHost(it) } },
        bottomBar = bottomBar,
        floatingActionButton = floatingActionButton,
    ) { padding ->
        // The frame applies the bar's padding itself, so a screen that forgets
        // to can't slide its first row under the top app bar.
        if (onRefresh == null) {
            Box(Modifier.fillMaxSize().padding(padding)) { content(PaddingValues()) }
        } else {
            var refreshing by remember { mutableStateOf(false) }
            val scope = rememberCoroutineScope()
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        try {
                            onRefresh()
                        } finally {
                            refreshing = false
                        }
                    }
                },
                modifier = Modifier.fillMaxSize().padding(padding),
            ) {
                Box(Modifier.fillMaxSize()) { content(PaddingValues()) }
            }
        }
    }
}
