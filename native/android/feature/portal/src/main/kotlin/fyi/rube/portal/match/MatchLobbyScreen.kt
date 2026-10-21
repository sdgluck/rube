// Movie match's front door for a user of this server: start a room, join one
// by its code or its invite link, or go back to one you're in. Guests never
// see this — they arrive in a room from its invite. From
// `apps/portal/src/match/Lobby.tsx`.
@file:OptIn(ExperimentalMaterial3Api::class)

package fyi.rube.portal.match

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircle
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.DeepLink
import fyi.rube.api.MatchCode
import fyi.rube.api.MatchText
import fyi.rube.api.ServerAddress
import fyi.rube.model.MatchRoomSummary
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LocalShell
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.error
import fyi.rube.platform.ui.next
import fyi.rube.portal.LocalPortal
import kotlinx.coroutines.launch

@Composable
fun MatchLobbyScreen(onNewRoom: (String) -> Unit, onRoom: (code: String, invite: String?) -> Unit) {
    val model = LocalPortal.current
    val shell = LocalShell.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var libraries by remember { mutableStateOf<LoadState<List<Portal.MatchLibrariesItem>>>(LoadState.Loading) }
    var rooms by remember { mutableStateOf(emptyList<MatchRoomSummary>()) }
    var code by remember { mutableStateOf("") }
    var link by remember { mutableStateOf("") }
    var joinError by remember { mutableStateOf<String?>(null) }
    var joining by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }

    suspend fun load() {
        libraries = libraries.next { model.client.call(PortalApi.matchLibraries) }
        if (libraries.error is ApiError.Forbidden) model.componentWentAway()
        rooms = try {
            model.client.call(PortalApi.matchRooms)
        } catch (e: ApiError) {
            rooms
        }
    }

    fun joinByCode() {
        val normal = MatchCode.normalise(code) ?: return
        joining = true
        joinError = null
        scope.launch {
            try {
                val joined = model.client.call(PortalApi.matchJoin, Portal.MatchJoinInput(code = normal))
                code = ""
                onRoom(joined.code, null)
            } catch (e: ApiError) {
                joinError = e.message
            } finally {
                joining = false
            }
        }
    }

    fun joinByLink(raw: String = link) {
        joinError = null
        val parsed = (DeepLink.parse(raw, allowPlexTvOverride = false) as? DeepLink.Match)?.link
        if (parsed == null) {
            joinError = "That isn't a movie match invite link."
            return
        }
        link = ""
        if (ServerAddress.origin(model.baseUrl) == parsed.server) {
            onRoom(parsed.code, parsed.invite)
        } else {
            // A room on somebody else's server: join it as their guest.
            shell.state.guestMatch = parsed
        }
    }

    LaunchedEffect(Unit) { load() }

    TbScreen("Movie Match", actions = { PartMenu() }, onRefresh = { load() }) {
        LazyColumn(Modifier.fillMaxSize()) {
            item {
                ElevatedCard(Modifier.fillMaxWidth().padding(16.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            "Can't decide what to watch? Start a room, invite whoever's watching, and swipe through the films. Anything everyone likes is a match.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        when (val l = libraries) {
                            LoadState.Loading -> CircularProgressIndicator()
                            is LoadState.Failed -> ErrorState(l.error, onRetry = { scope.launch { load() } })
                            is LoadState.Loaded ->
                                if (l.value.isEmpty()) {
                                    Text("None of the movie libraries here are shared with you.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                } else {
                                    Button(
                                        onClick = { if (l.value.size == 1) onNewRoom(l.value[0].key) else picking = true },
                                        modifier = Modifier.fillMaxWidth().testTag("start-room"),
                                    ) {
                                        Icon(Icons.Outlined.AddCircle, contentDescription = null)
                                        Text("Start a room", Modifier.padding(start = 8.dp))
                                    }
                                }
                        }
                    }
                }
            }
            item { SectionHeader("Join a room") }
            item {
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = MatchCode.filterTyping(it) },
                        placeholder = { Text("ABCD") },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { joinByCode() }),
                        modifier = Modifier.weight(1f).testTag("room-code"),
                    )
                    FilledTonalButton(onClick = { joinByCode() }, enabled = code.length == MatchCode.LENGTH && !joining, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Join")
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = link,
                    onValueChange = { link = it },
                    placeholder = { Text("Paste an invite link") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { joinByLink() }),
                    trailingIcon = {
                        IconButton(onClick = {
                            val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                            if (text != null) {
                                link = text
                                joinByLink(text)
                            }
                        }) { Icon(Icons.Outlined.ContentPaste, contentDescription = "Paste") }
                    },
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                )
            }
            joinError?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
            }
            if (rooms.isNotEmpty()) {
                item { SectionHeader("Your rooms") }
                items(rooms, key = { it.code }) { room ->
                    ListItem(
                        headlineContent = {
                            Text(room.code, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
                        },
                        supportingContent = {
                            Column {
                                Text((listOf(room.library) + MatchText.pills(room.filters)).joinToString(" · "), maxLines = 1)
                                Text(room.members.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                            }
                        },
                        modifier = Modifier.clickable { onRoom(room.code, null) },
                    )
                }
            }
        }
    }

    if (picking) {
        val libs = (libraries as? LoadState.Loaded)?.value.orEmpty()
        ModalBottomSheet(onDismissRequest = { picking = false }) {
            Text("Which library?", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            for (lib in libs) {
                ListItem(
                    headlineContent = { Text(lib.title) },
                    trailingContent = { Text("${lib.count} films") },
                    modifier = Modifier.clickable {
                        picking = false
                        onNewRoom(lib.key)
                    },
                )
            }
        }
    }
}
