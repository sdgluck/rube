// Where the app keeps what would let somebody else be you: session tokens,
// the per-install Plex client id, movie-match guest tokens.
//
// A DataStore file whose values are sealed with an AES-GCM key that lives in
// the Android Keystore and never leaves it. EncryptedSharedPreferences did
// the same and is deprecated; this is the same idea with no Jetpack Security
// in between. The key is device-bound, so a backup restored onto another phone
// carries ciphertext nothing there can open — which reads as signed out, the
// same outcome as iOS's `ThisDeviceOnly` Keychain items, rather than a crash.
// (The manifest also turns backup off; this is the second line.)
//
// The interface is synchronous because the callers are: a connection is read
// to build a client, and the whole store is small. Values are decrypted once
// into memory at start-up and written through to disk in order.
package fyi.rube.platform

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SecretStore {
    fun get(key: String): String?
    fun set(key: String, value: String?)

    /** Forget everything — `-TBResetState` in a debug build. */
    fun clear()
}

/** For tests: the same contract, gone when the process ends. */
class InMemorySecretStore : SecretStore {
    private val values = ConcurrentHashMap<String, String>()
    override fun get(key: String): String? = values[key]
    override fun set(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
    override fun clear() = values.clear()
}

private val Context.secretsFile: DataStore<Preferences> by preferencesDataStore(name = "secrets")

class KeystoreSecretStore(context: Context) : SecretStore {
    private val store = context.applicationContext.secretsFile
    private val cache = ConcurrentHashMap<String, String>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** One writer, in call order, so a set followed by a clear lands as a clear. */
    private val writes = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        // Once, at start-up, before any screen asks: a few hundred bytes.
        runBlocking(Dispatchers.IO) {
            val prefs = store.data.first()
            for ((k, v) in prefs.asMap()) {
                val plain = (v as? String)?.let(::open) ?: continue
                cache[k.name] = plain
            }
        }
        scope.launch { for (write in writes) write() }
    }

    override fun get(key: String): String? = cache[key]

    override fun set(key: String, value: String?) {
        if (value == null) cache.remove(key) else cache[key] = value
        val sealed = value?.let(::seal)
        writes.trySend {
            store.edit { prefs ->
                val k = stringPreferencesKey(key)
                if (sealed == null) prefs.remove(k) else prefs[k] = sealed
            }
        }
    }

    override fun clear() {
        cache.clear()
        writes.trySend { store.edit { it.clear() } }
    }

    private fun key(): SecretKey {
        val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keystore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** `base64(iv) . base64(ciphertext+tag)`. */
    private fun seal(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    /** Null for anything that won't open — a restored backup, a reinstalled key. */
    private fun open(stored: String): String? = try {
        val (iv, body) = stored.split('.', limit = 2)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        }
        String(cipher.doFinal(Base64.decode(body, Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "fyi.rube.secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
