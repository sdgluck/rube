// End-to-end smoke tests against `pnpm native:dev-server`: the seeded admin
// (39311), portal (39312) and mock plex.tv (39313) on the host, reached from
// the emulator as 10.0.2.2. The Android twin of `SmokeTests.swift`.
//
// Each test starts from a fresh install (`tb.resetState`), is handed the dev
// server's connect link (`tb.openUrl`, as if a QR code had been scanned) and
// signs in headlessly as a seeded Plex account (`tb.devSignInAs`), which
// approves the PIN on the mock instead of opening plex.tv. All three extras
// exist only in debug builds.
//
// Every screen visited is also saved as a PNG on the device
// (Download/rube-shots), for looking at the layout: `adb pull` them afterwards.
package fyi.rube.app

import android.content.ContentValues
import android.content.Intent
import android.provider.MediaStore
import android.graphics.Bitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class SmokeTest {
    @get:Rule
    val rule = createEmptyComposeRule()

    private var scenario: ActivityScenario<MainActivity>? = null
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @After
    fun close() {
        scenario?.close()
    }

    private fun launch(signInAs: String?, url: String) {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(DevFlags.RESET_STATE, true)
            .putExtra(DevFlags.OPEN_URL, url)
        if (signInAs != null) intent.putExtra(DevFlags.SIGN_IN_AS, signInAs)
        scenario = ActivityScenario.launch(intent)
    }

    // Finding things

    // Unmerged: a tag on text inside a list row or a button is folded into
    // the row's node in the merged tree and can't be found there.
    private fun ComposeTestRule.waitFor(matcher: SemanticsMatcher, timeoutMs: Long) =
        waitUntil(timeoutMs) { onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }

    private fun ComposeTestRule.waitForTag(tag: String, timeoutMs: Long = 20_000) = waitFor(hasTestTag(tag), timeoutMs)

    private fun ComposeTestRule.waitForText(text: String, timeoutMs: Long = 20_000) = waitFor(hasText(text, substring = true), timeoutMs)

    private fun tagStartingWith(prefix: String) = SemanticsMatcher("test tag starts with $prefix") {
        it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith(prefix) == true
    }

    private fun tagOf(matcher: SemanticsMatcher): String =
        rule.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().first().config[SemanticsProperties.TestTag]

    private fun descriptionOf(tag: String): String =
        rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString() ?: ""

    private fun titles(): List<String> =
        rule.onAllNodes(hasTestTag("screen-title"), useUnmergedTree = true).fetchSemanticsNodes()
            .mapNotNull { it.config.getOrNull(SemanticsProperties.Text)?.joinToString() }

    private fun titleText(prefix: String = ""): String = titles().lastOrNull { it.startsWith(prefix) } ?: titles().lastOrNull() ?: ""

    private fun waitForTitle(prefix: String, timeoutMs: Long = 20_000) {
        try {
            rule.waitUntil(timeoutMs) { runCatching { titles().any { it.startsWith(prefix) } }.getOrDefault(false) }
        } catch (e: Throwable) {
            throw AssertionError("no screen titled $prefix…; titles on screen: ${titles()}", e)
        }
    }

    private fun tap(tag: String) = rule.onNodeWithTag(tag, useUnmergedTree = false).performClick()

    /** Confirm the link's servers, then sign in. */
    private fun connectAndSignIn() {
        rule.waitForTag("connect")
        // The probe runs on appearing; wait for it so the button doesn't race it.
        rule.waitForText("Rube 0.", 20_000)
        shot("01-connect")
        tap("connect")
        rule.waitForTag("sign-in")
        shot("02-sign-in")
        tap("sign-in")
    }

    @Test
    fun theOwnerSeesThePortalThenSwitchesToAdmin() {
        launch(signInAs = OWNER, url = DevServer.connectLink)
        connectAndSignIn()

        rule.waitForTag("tab-Tastes", 30_000)
        for (tab in listOf("Tastes", "Collections", "Match", "Leaving", "Account")) rule.onNodeWithTag("tab-$tab").assertExists()
        rule.waitForTag("save-status")
        shot("03-portal-tastes")
        tap("tab-Collections")
        waitForTitle("Your Collections")
        Thread.sleep(1_000)
        shot("04-portal-collections")
        tap("tab-Leaving")
        waitForTitle("Leaving Soon")
        Thread.sleep(1_000)
        shot("05-portal-leaving")
        tap("tab-Account")
        waitForTitle("Account")
        Thread.sleep(500)
        shot("06-portal-account")

        rule.waitForTag("part-menu", 5_000)
        assertTrue("an admin can switch: ${descriptionOf("part-menu")}", descriptionOf("part-menu").contains("Admin"))
        tap("part-menu")
        rule.waitForTag("part-rube-admin", 5_000)
        tap("part-rube-admin")

        waitForTitle("Overview")
        rule.waitForText("Now playing", 10_000)
        Thread.sleep(1_500)
        shot("07-admin-overview")
        tap("tab-Jobs")
        waitForTitle("Jobs")
        Thread.sleep(1_500)
        shot("08-admin-jobs")
        tap("tab-Cleanup")
        waitForTitle("Cleanup")
        Thread.sleep(1_500)
        shot("09-admin-cleanup")
        tap("tab-Collections")
        waitForTitle("Collections")
        Thread.sleep(2_000)
        shot("10-admin-collections")
        tap("tab-Users")
        waitForTitle("Users")
        Thread.sleep(2_000)
        shot("11-admin-users")
    }

    @Test
    fun aSharedUserHasNoAdminPart() {
        launch(signInAs = SHARED_USER, url = DevServer.connectLink)
        connectAndSignIn()

        rule.waitForTag("tab-Account", 30_000)
        rule.waitForTag("part-menu", 5_000)
        assertFalse("no switch for a portal user: ${descriptionOf("part-menu")}", descriptionOf("part-menu").contains("Admin"))
        tap("part-menu")
        rule.waitForTag("open-settings", 5_000)
        assertTrue("the menu offers no Admin part", rule.onAllNodes(hasTestTag("part-rube-admin")).fetchSemanticsNodes().isEmpty())
        shot("20-shared-user-menu")
    }

    /**
     * The whole of a room, from the owner's side: create it in the app, have a
     * guest (played over HTTP by [DevServer]) like every film, then swipe,
     * undo, match, vote and withdraw the vote, reset, and leave — checking
     * each step against the server's own `match.state`.
     */
    @Test
    fun theOwnerPlaysAMatchRoomEndToEnd() {
        launch(signInAs = OWNER, url = DevServer.connectLink)
        connectAndSignIn()

        rule.waitForTag("tab-Match", 30_000)
        tap("tab-Match")
        rule.waitForTag("start-room", 15_000)
        shot("12-match-lobby")
        tap("start-room")
        rule.waitForTag("create-room", 15_000)
        // Wait for the live count, so the room isn't started from an unknown deck.
        rule.waitForText("films", 15_000)
        shot("13-match-new-room")
        tap("create-room")

        waitForTitle("Room ")
        val code = titleText("Room ").removePrefix("Room ").trim()
        assertEquals("a room code: $code", 4, code.length)

        // The second member: a guest who likes everything.
        val owner = DevServer.portalSession(OWNER)
        val invite = DevServer.state(code, owner).getString("invite")
        DevServer.guestWhoLikesEverything(code, invite, "Gus")

        rule.waitForTag("like", 20_000)
        rule.waitForTag("swipe-card", 20_000)
        Thread.sleep(1_000)
        shot("14-match-deck")

        // Nope by dragging, then take it back: the same film is on top again.
        val firstTitle = descriptionOf("swipe-card")
        rule.onNodeWithTag("swipe-card").performTouchInput { swipeLeft() }
        rule.waitUntil(5_000) { runCatching { rule.onNodeWithTag("undo").assertIsEnabled(); true }.getOrDefault(false) }
        tap("undo")
        rule.waitUntil(5_000) { runCatching { descriptionOf("swipe-card") == firstTitle }.getOrDefault(false) }
        assertEquals("undo puts the card back", firstTitle, descriptionOf("swipe-card"))

        // A like the guest already gave is a match.
        tap("like")
        rule.waitForTag("see-matches", 15_000)
        Thread.sleep(800)
        shot("15-match-its-a-match")
        tap("keep-swiping")
        rule.waitUntil(5_000) { rule.onAllNodes(hasTestTag("see-matches")).fetchSemanticsNodes().isEmpty() }

        // A couple more: one nope by button, one like (another match, dismissed).
        rule.waitUntil(5_000) { runCatching { rule.onNodeWithTag("nope").assertIsEnabled(); true }.getOrDefault(false) }
        tap("nope")
        Thread.sleep(1_000)
        rule.waitUntil(5_000) { runCatching { rule.onNodeWithTag("like").assertIsEnabled(); true }.getOrDefault(false) }
        tap("like")
        if (runCatching { rule.waitForTag("keep-swiping", 10_000); true }.getOrDefault(false)) tap("keep-swiping")
        Thread.sleep(1_500)
        val swiped = DevServer.state(code, owner)
        assertEquals("three swipes landed after the undo", 3, swiped.getJSONObject("me").getInt("swiped"))
        assertEquals("two films everyone liked", 2, swiped.getInt("unanimousCount"))

        // Vote, then withdraw it — the second tap sends ratingKey: null.
        tap("tab-matches")
        rule.waitFor(tagStartingWith("vote-"), 10_000)
        val voteTag = tagOf(tagStartingWith("vote-"))
        val votedKey = voteTag.removePrefix("vote-")
        rule.onNodeWithTag(voteTag).performClick()
        rule.waitForText("Your pick", 10_000)
        shot("16-match-matches")
        assertEquals(votedKey, DevServer.state(code, owner).optString("myVote"))
        rule.onNodeWithTag(voteTag).performClick()
        rule.waitUntil(10_000) { rule.onAllNodes(hasText("Your pick", substring = true)).fetchSemanticsNodes().isEmpty() }
        Thread.sleep(500)
        assertTrue("withdrawn on the server too", DevServer.state(code, owner).isNull("myVote"))

        // Start over: the server forgets this member's swipes.
        tap("room-options")
        rule.waitForTag("menu-start-over", 5_000)
        tap("menu-start-over")
        rule.waitForTag("confirm-start-over", 5_000)
        tap("confirm-start-over")
        Thread.sleep(2_000)
        assertEquals("reset clears my swipes", 0, DevServer.state(code, owner).getJSONObject("me").getInt("swiped"))
        rule.waitForTag("like", 10_000)

        // Leave: back in the lobby, and the room is no longer mine.
        tap("room-options")
        rule.waitForTag("menu-leave", 5_000)
        tap("menu-leave")
        rule.waitForTag("confirm-leave", 5_000)
        tap("confirm-leave")
        rule.waitForTag("start-room", 15_000)
        val rooms = DevServer.query("match.rooms", JSONObject(), owner) as JSONArray
        assertFalse("left room $code", (0 until rooms.length()).any { rooms.getJSONObject(it).getString("code") == code })
    }

    /**
     * Someone with no account: opens an invite link on a fresh install,
     * previews the room, gives a name, joins, swipes — and matches with the
     * owner, who liked that film first (over HTTP).
     */
    @Test
    fun aGuestJoinsFromAnInviteLink() {
        val owner = DevServer.portalSession(OWNER)
        val created = DevServer.mutate("match.create", JSONObject().put("sectionId", "1").put("filters", JSONObject()), owner) as JSONObject
        val code = created.getString("code")
        val invite = created.getString("invite")
        val deck = DevServer.query("match.deck", JSONObject().put("code", code).put("exclude", JSONArray()).put("limit", 1), owner) as JSONObject
        val first = deck.getJSONArray("films").getJSONObject(0).getString("ratingKey")
        DevServer.mutate("match.swipe", JSONObject().put("code", code).put("ratingKey", first).put("liked", true), owner)

        launch(signInAs = null, url = "rube://match?server=${DevServer.enc(DevServer.portal)}&code=$code&invite=${DevServer.enc(invite)}")

        rule.waitForTag("guest-name", 20_000)
        rule.waitForText("owner", 10_000)
        shot("17-guest-join")
        rule.onNodeWithTag("guest-name").performTextInput("Gus")
        rule.waitUntil(5_000) { runCatching { rule.onNodeWithTag("guest-join").assertIsEnabled(); true }.getOrDefault(false) }
        tap("guest-join")

        try {
            rule.waitForTag("like", 20_000)
        } catch (e: Throwable) {
            shot("17-guest-join-failed")
            throw e
        }
        rule.waitForTag("swipe-card", 20_000)
        Thread.sleep(2_000)
        shot("18-guest-deck")
        tap("like")
        rule.waitForTag("see-matches", 15_000)
        Thread.sleep(800)
        shot("19-guest-its-a-match")
        tap("see-matches")

        val members = DevServer.state(code, owner).getJSONArray("members")
        assertTrue("the guest is in the room", (0 until members.length()).any {
            val m = members.getJSONObject(it)
            m.getString("name") == "Gus" && m.getBoolean("guest")
        })
    }

    /**
     * The screen as it is, into Downloads/rube-shots — MediaStore, so it
     * outlives the uninstall that ends every connected test run.
     */
    private fun shot(name: String) {
        rule.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "$name.png")
            put(MediaStore.Downloads.MIME_TYPE, "image/png")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/rube-shots")
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return
        resolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private companion object {
        const val OWNER = "1"
        const val SHARED_USER = "101"
    }
}
