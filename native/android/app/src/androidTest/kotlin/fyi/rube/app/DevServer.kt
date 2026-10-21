// The other people in a test's movie match room: plain tRPC calls from the
// test to the dev server (`pnpm native:dev-server`), beside the app.
//
// A match needs a second member to like the same film, and an invite needs a
// room someone else made. Driving a second emulator for that would be slow
// and flaky; the server can't tell a guest swiping from here from one swiping
// in the app, so the test plays that part over HTTP. The emulator reaches the
// host machine as 10.0.2.2.
package fyi.rube.app

import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

object DevServer {
    private val host: String = InstrumentationRegistry.getArguments().getString("devHost") ?: "10.0.2.2"
    val admin = "http://$host:39311"
    val portal = "http://$host:39312"
    val plexTv = "http://$host:39313"

    val connectLink: String
        get() = "rube://connect?admin=${enc(admin)}&portal=${enc(portal)}&plexTv=${enc(plexTv)}"

    private val http = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    sealed interface Who {
        data class Session(val token: String) : Who
        data class Guest(val token: String) : Who
    }

    /** A portal session for a seeded Plex account, by the same PIN flow the app uses, approved on the mock plex.tv. */
    fun portalSession(account: String): Who.Session {
        val client = "uitest-${UUID.randomUUID()}"
        fun plex(path: String) = Request.Builder().url("$plexTv$path")
            .header("X-Plex-Client-Identifier", client)
            .header("X-Plex-Product", "Rube")
            .header("Accept", "application/json")
        val pin = JSONObject(body(plex("/api/v2/pins?strong=true").post(ByteArray(0).toRequestBody(null)).build()))
        body(Request.Builder().url("$plexTv/auth?code=${pin.getString("code")}&as=$account").build())
        val token = JSONObject(body(plex("/api/v2/pins/${pin.getLong("id")}").build())).optString("authToken")
        check(token.isNotEmpty()) { "PIN ${pin.getLong("id")} not approved" }
        val out = mutate("auth.exchange", JSONObject().put("plexToken", token)) as JSONObject
        return Who.Session(out.getString("token"))
    }

    fun query(path: String, input: JSONObject, who: Who? = null): Any {
        val url = "$portal/api/trpc/$path?input=" + enc(input.toString()).replace("+", "%20")
        return data(authorise(Request.Builder().url(url), who).build(), path)
    }

    fun mutate(path: String, input: JSONObject, who: Who? = null): Any {
        val request = Request.Builder().url("$portal/api/trpc/$path").post(input.toString().toRequestBody("application/json".toMediaType()))
        return data(authorise(request, who).build(), path)
    }

    private fun authorise(r: Request.Builder, who: Who?) = when (who) {
        is Who.Session -> r.header("Authorization", "Bearer ${who.token}")
        is Who.Guest -> r.header("X-Match-Guest", who.token)
        null -> r
    }

    /**
     * `result.data`, or the server's error — including "Output validation
     * failed", which is a server bug to report, not to work around.
     */
    private fun data(r: Request, path: String): Any {
        val json = JSONObject(body(r))
        json.optJSONObject("error")?.let { throw AssertionError("$path: $it") }
        return json.optJSONObject("result")?.opt("data") ?: JSONObject.NULL
    }

    private fun body(r: Request): String = http.newCall(r).execute().use { it.body.string() }

    // Movie match

    fun state(code: String, who: Who): JSONObject = query("match.state", JSONObject().put("code", code), who) as JSONObject

    /** Joins as a named guest and likes every film in the deck, so whatever the app's user likes next is a match. */
    fun guestWhoLikesEverything(code: String, invite: String, name: String): Who.Guest {
        val joined = mutate("match.guest.join", JSONObject().put("code", code).put("invite", invite).put("name", name)) as JSONObject
        val guest = Who.Guest(joined.getString("token"))
        val deck = query("match.deck", JSONObject().put("code", code).put("exclude", JSONArray()).put("limit", 50), guest) as JSONObject
        val films = deck.getJSONArray("films")
        for (i in 0 until films.length()) {
            mutate("match.swipe", JSONObject().put("code", code).put("ratingKey", films.getJSONObject(i).getString("ratingKey")).put("liked", true), guest)
        }
        return guest
    }
}
