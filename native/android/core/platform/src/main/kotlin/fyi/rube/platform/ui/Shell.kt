// What the two halves of the app share from the shell around them: the
// Portal ⇄ Admin switch, the way to open Settings, the Settings rows
// themselves, and links waiting to be opened. Handed down as a
// CompositionLocal because the shell (sign-in, connecting, the lock) lives in
// :app, which the feature modules can't depend on — and shouldn't, or a screen
// could start a sign-in.
package fyi.rube.platform.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CompareArrows
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import fyi.rube.api.MatchLink
import fyi.rube.api.ServerProduct

/**
 * Requests between a screen and the shell. Plain Compose state, so a screen
 * reading [pendingMatch] recomposes when a link lands.
 */
class ShellState {
    /** A `rube://match` link for the signed-in portal user, waiting for the Match tab. */
    var pendingMatch by mutableStateOf<MatchLink?>(null)

    /** A room to join as a guest — on a server you have no session with. */
    var guestMatch by mutableStateOf<MatchLink?>(null)
}

/** The shell's side of the contract, as the features see it. */
class Shell(
    val state: ShellState,
    /** Signed in to both halves, so the switch is offered. A portal user never sees that an admin half exists. */
    val canSwitch: Boolean,
    val part: ServerProduct,
    val switchTo: (ServerProduct) -> Unit,
    val openSettings: () -> Unit,
    /** The app's own settings rows, for the portal's Account tab to embed. */
    val settingsContent: @Composable () -> Unit,
)

val LocalShell = staticCompositionLocalOf<Shell> { error("No Shell provided") }

/**
 * The account button at the top of every tab: which half you're in, and
 * Settings. Tagged `part-menu` and described as the switch it offers, which
 * is what the UI tests read to tell an owner from a shared user.
 */
@Composable
fun PartMenu(shell: Shell = LocalShell.current) {
    var open by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val description = if (shell.canSwitch) "Switch to ${if (shell.part == ServerProduct.PORTAL) "Admin" else "Portal"}" else "Settings"
    IconButton(
        onClick = { open = true },
        modifier = Modifier.testTag("part-menu").semantics { contentDescription = description },
    ) {
        Icon(if (shell.canSwitch) Icons.AutoMirrored.Outlined.CompareArrows else Icons.Outlined.AccountCircle, contentDescription = null)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        if (shell.canSwitch) {
            for ((part, icon) in listOf(ServerProduct.PORTAL to Icons.Outlined.Tv, ServerProduct.ADMIN to Icons.Outlined.AdminPanelSettings)) {
                DropdownMenuItem(
                    text = { Text(part.label) },
                    leadingIcon = { Icon(icon, contentDescription = null) },
                    trailingIcon = { RadioButton(selected = shell.part == part, onClick = null) },
                    onClick = {
                        open = false
                        if (shell.part != part) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            shell.switchTo(part)
                        }
                    },
                    modifier = Modifier.testTag("part-${part.raw}"),
                )
            }
            HorizontalDivider()
        }
        DropdownMenuItem(
            text = { Text("Settings") },
            leadingIcon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
            onClick = {
                open = false
                shell.openSettings()
            },
            modifier = Modifier.testTag("open-settings"),
        )
    }
}
