// Plain, non-secret settings: server addresses and switches. SharedPreferences
// rather than DataStore because every reader is synchronous and the values are
// a handful of strings — and nothing here would let anyone be you, which is
// the line between this and `SecretStore`.
package fyi.rube.platform

import android.content.Context
import android.content.SharedPreferences
import fyi.rube.api.ServerProduct
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap

interface KeyValueStore {
    fun string(key: String): String?
    fun setString(key: String, value: String?)
    fun bool(key: String): Boolean = string(key) == "true"
    fun setBool(key: String, value: Boolean) = setString(key, value.toString())
    fun clear()
}

class InMemoryKeyValueStore : KeyValueStore {
    val values = ConcurrentHashMap<String, String>()
    override fun string(key: String): String? = values[key]
    override fun setString(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
    override fun clear() = values.clear()
}

class SharedPrefsStore(context: Context, name: String = "rube") : KeyValueStore {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun string(key: String): String? = prefs.getString(key, null)
    override fun setString(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
    override fun clear() {
        prefs.edit().clear().apply()
    }
}

/**
 * Light, dark, or the system's. Dark by default: Rube is used with the
 * lights down, next to a TV, and the web apps have always opened dark.
 */
enum class Appearance(val label: String) {
    SYSTEM("System"),
    DARK("Dark"),
    LIGHT("Light"),
}

class AppSettings(private val store: KeyValueStore) {
    private val _appearance = MutableStateFlow(
        store.string(APPEARANCE)?.let { raw -> Appearance.entries.firstOrNull { it.name == raw } } ?: Appearance.DARK,
    )
    val appearance: StateFlow<Appearance> = _appearance.asStateFlow()

    /** Which half was open last, so an admin comes back where they were. */
    private val _lastPart = MutableStateFlow(ServerProduct.fromRaw(store.string(PART)) ?: ServerProduct.PORTAL)
    val lastPart: StateFlow<ServerProduct> = _lastPart.asStateFlow()

    fun setAppearance(value: Appearance) {
        _appearance.value = value
        store.setString(APPEARANCE, value.name)
    }

    fun setLastPart(value: ServerProduct) {
        _lastPart.value = value
        store.setString(PART, value.raw)
    }

    private companion object {
        const val APPEARANCE = "tb.appearance"
        const val PART = "tb.part"
    }
}
