// The fingerprint, face or screen lock in front of the app.
//
// Opt-in, as in the Capacitor app (`packages/native-client/src/lock.ts`). The
// sessions already sit in the Keystore-sealed store, so this guards against
// someone holding the unlocked phone, not against theft of a token — worth
// offering for an app that can empty a media library, not worth imposing on
// someone who only picks genres.
//
// Locks on a cold start and on return after five minutes away. Relocking on
// every app switch would make copying an address from the browser into the
// connect screen a fingerprint each way.
package dev.tinkerbell.platform

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Proving it's the owner. Split out so the lock's timing is tested without a device. */
fun interface Authenticator {
    suspend fun authenticate(title: String): Boolean
}

class AppLock(
    private val store: KeyValueStore,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _enabled = MutableStateFlow(store.bool(KEY))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    private val _locked = MutableStateFlow(store.bool(KEY))
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    private var backgroundedAt: Long? = null

    suspend fun unlock(auth: Authenticator) {
        if (auth.authenticate("Unlock Tinkerbell")) markUnlocked()
    }

    fun markUnlocked() {
        _locked.value = false
    }

    /**
     * Proves it works before relying on it: a lock you can't open is a
     * lockout. Returns whether it is now on.
     */
    suspend fun setEnabled(on: Boolean, auth: Authenticator): Boolean {
        if (on && !auth.authenticate("Turn on the app lock")) return _enabled.value
        _enabled.value = on
        store.setBool(KEY, on)
        if (!on) _locked.value = false
        return on
    }

    fun didEnterBackground() {
        backgroundedAt = now()
    }

    fun willEnterForeground() {
        val away = backgroundedAt
        backgroundedAt = null
        if (!_enabled.value || away == null) return
        if (now() - away >= RELOCK_AFTER_MS) _locked.value = true
    }

    /** Forget the switch — `-TBResetState`. */
    fun reset() {
        _enabled.value = false
        _locked.value = false
    }

    companion object {
        const val RELOCK_AFTER_MS = 5 * 60 * 1000L
        const val KEY = "tb.lock"
    }
}

/**
 * BiometricPrompt with the screen lock as the fallback, so a failed
 * fingerprint is never a lockout from your own app.
 */
class BiometricAuthenticator(private val activity: FragmentActivity) : Authenticator {
    override suspend fun authenticate(title: String): Boolean = suspendCancellableCoroutine { cont ->
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (cont.isActive) cont.resume(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (cont.isActive) cont.resume(false)
                }
                // onAuthenticationFailed is one bad read; the prompt stays up for another go.
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                .build(),
        )
        cont.invokeOnCancellation { prompt.cancelAuthentication() }
    }

    companion object {
        /** Any way to prove it's the owner — biometrics or the screen lock. */
        fun isAvailable(activity: FragmentActivity): Boolean =
            BiometricManager.from(activity).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS

        fun hasBiometrics(activity: FragmentActivity): Boolean =
            BiometricManager.from(activity).canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS
    }
}
