// The hand-written half of :core:model: what the generated `Api.kt` refers to
// but can't describe itself. Kept beside it, and kept small, so the generated
// file stays a pure function of the server's schemas. The Swift twin is
// `RubeModels/Support.swift`.
package fyi.rube.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable

/**
 * One tRPC procedure: where it lives, whether it is a GET (query) or a POST
 * (mutation), and how to write its input and read its answer. The generated
 * `PortalApi` / `AdminApi` objects hold one of these per procedure the app
 * calls; the client in :core:api is what sends them.
 *
 * The serializers travel with the endpoint rather than being looked up by
 * reified type at the call site, because the outputs include lists, maps and
 * nullable types whose serializers the generator already had to spell out.
 */
class Endpoint<I, O>(
    val path: String,
    val kind: Kind,
    val input: KSerializer<I>,
    val output: KSerializer<O>,
) {
    enum class Kind { QUERY, MUTATION }

    override fun toString(): String = "Endpoint($path, $kind)"
}

/**
 * A procedure that takes no input. The client never encodes it: a query
 * leaves `?input=` off and a mutation sends an empty body, which is what
 * tRPC reads as "no input" — `{}` would fail a procedure with no `.input()`.
 */
@Serializable
object NoInput

/**
 * A procedure that answers nothing. tRPC sends `{"result":{}}` with no `data`;
 * the client returns this instead of failing to decode a missing key.
 */
@Serializable
object NoOutput

/**
 * The two JSON configurations the wire needs — one each way, because the
 * server's rules for nulls differ by direction.
 *
 * Reading: unknown keys are ignored (a newer server adds fields), and a
 * nullable field the server left out reads as null (`explicitNulls = false`),
 * since zod's `.optional()` and `.nullable()` both reach the app as `T?`.
 *
 * Writing: nulls are written. `explicitNulls = false` here would drop them,
 * and `match.vote` with `ratingKey: null` is "withdraw my vote" — the key has
 * to be present. Optional inputs are still left out, because the generator
 * gives them a `= null` default and defaults aren't encoded.
 */
object WireJson {
    val decoder: kotlinx.serialization.json.Json = kotlinx.serialization.json.Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val encoder: kotlinx.serialization.json.Json = kotlinx.serialization.json.Json {
        explicitNulls = true
        encodeDefaults = false
    }
}
