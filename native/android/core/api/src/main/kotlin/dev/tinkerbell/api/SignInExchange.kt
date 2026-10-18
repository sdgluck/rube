// Trading a Plex token for a Tinkerbell session, on each server separately.
//
// The portal and admin servers each ask plex.tv who the token belongs to and
// decide for themselves; neither trusts the other's answer, so a session from
// one is worthless to the other. The outcomes are kept apart too: being a
// portal user and not an admin is the ordinary case, not a failed sign-in.
package dev.tinkerbell.api

import dev.tinkerbell.model.Admin
import dev.tinkerbell.model.AdminApi
import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.PortalApi
import kotlin.coroutines.cancellation.CancellationException

sealed interface ExchangeOutcome {
    data class SignedIn(val username: String, val token: String) : ExchangeOutcome {
        override fun toString() = "SignedIn($username)"
    }

    /** Admin only: sign-in is switched off on that server, so there is no session to hold. */
    data object Open : ExchangeOutcome

    /** The server knows who this is and won't let them in. Its message says why. */
    data class Refused(val message: String) : ExchangeOutcome
    data class Failed(val error: ApiError) : ExchangeOutcome
}

object SignInExchange {
    // An exchange never presents an old session alongside the Plex token.
    suspend fun portal(client: TrpcClient, plexToken: String): ExchangeOutcome = outcome {
        val out = client.with(Credential.None).call(PortalApi.authExchange, Portal.AuthExchangeInput(plexToken))
        ExchangeOutcome.SignedIn(out.username, out.token)
    }

    suspend fun admin(client: TrpcClient, plexToken: String): ExchangeOutcome = outcome {
        when (val out = client.with(Credential.None).call(AdminApi.authExchange, Admin.AuthExchangeInput(plexToken))) {
            is Admin.AuthExchangeOutput.Ok -> ExchangeOutcome.SignedIn(out.value.username, out.value.token)
            is Admin.AuthExchangeOutput.Open -> ExchangeOutcome.Open
        }
    }

    private inline fun outcome(block: () -> ExchangeOutcome): ExchangeOutcome = try {
        block()
    } catch (e: ApiError.Forbidden) {
        ExchangeOutcome.Refused(e.message)
    } catch (e: ApiError) {
        ExchangeOutcome.Failed(e)
    }

    /**
     * Best effort: the session is dropped locally whatever the server says,
     * because a sign-out that fails offline must still sign out.
     */
    suspend fun logoutPortal(client: TrpcClient) {
        try {
            client.call(PortalApi.authLogout)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    suspend fun logoutAdmin(client: TrpcClient) {
        try {
            client.call(AdminApi.authLogout, Admin.AuthLogoutInput())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }
}
