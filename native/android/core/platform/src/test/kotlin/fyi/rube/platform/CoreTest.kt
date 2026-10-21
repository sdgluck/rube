// The stores' rules, against in-memory backing so they run on the JVM: what
// a new address does to a session, which 401 may sign you out, and when the
// lock comes back. From `CoreTests.swift`; the Keystore-sealed store itself is
// exercised on the emulator by the UI tests, which sign in through it.
package fyi.rube.platform

import fyi.rube.api.ServerProduct.ADMIN
import fyi.rube.api.ServerProduct.PORTAL
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class CoreTest {
    private fun store(secrets: SecretStore = InMemorySecretStore(), settings: KeyValueStore = InMemoryKeyValueStore(), debug: Boolean = false) =
        ConnectionStore(secrets, settings, debug)

    @Test
    fun connectionsPersistAddressesAndSessionsSeparately() {
        val secrets = InMemorySecretStore()
        val settings = InMemoryKeyValueStore()
        val store = store(secrets, settings)
        assertTrue(store.current.isEmpty)
        store.setServer(PORTAL, "http://tb.lan:3100")
        store.setSession(PORTAL, "p-tok")
        store.setServer(ADMIN, "http://tb.lan:3000")

        val reloaded = store(secrets, settings)
        assertEquals("p-tok", reloaded.current.portal?.sessionToken)
        assertNull(reloaded.current.admin?.sessionToken)
        // The token never lands in the plain settings.
        assertFalse(settings.values.values.contains("p-tok"))
    }

    @Test
    fun aNewAddressDropsTheOldSession() {
        val store = store()
        store.setServer(ADMIN, "http://a.lan:3000")
        store.setSession(ADMIN, "a-tok")
        store.setServer(ADMIN, "http://a.lan:3000")
        assertEquals("a-tok", store.current.admin?.sessionToken)
        store.setServer(ADMIN, "http://b.lan:3000")
        assertNull(store.current.admin?.sessionToken)
    }

    @Test
    fun aStale401DoesNotSignOutANewerSession() {
        val store = store()
        store.setServer(PORTAL, "http://tb.lan:3100")
        store.setSession(PORTAL, "new")
        store.clearSession(PORTAL, ifToken = "old")
        assertEquals("new", store.current.portal?.sessionToken)
        store.clearSession(PORTAL, ifToken = "new")
        assertNull(store.current.portal?.sessionToken)
        assertNotNull(store.current.portal)
    }

    @Test
    fun openAdminIsRememberedAndClearedByAnUnauthorized() {
        val secrets = InMemorySecretStore()
        val settings = InMemoryKeyValueStore()
        val store = store(secrets, settings)
        store.setServer(ADMIN, "http://tb.lan:3000")
        store.setSession(ADMIN, null, openAuth = true)
        assertEquals(true, store(secrets, settings).current.admin?.openAuth)
        assertEquals(true, store.current.admin?.isSignedIn)
        store.clearSession(ADMIN, ifToken = null)
        assertEquals(false, store.current.admin?.isSignedIn)
    }

    @Test
    fun aPortalCantBeOpen() {
        val store = store()
        store.setServer(PORTAL, "http://tb.lan:3100")
        store.setSession(PORTAL, null, openAuth = true)
        assertEquals(false, store.current.portal?.isSignedIn)
    }

    @Test
    fun thePlexClientIdIsMadeOnce() {
        val store = store()
        val id = store.plexClientId
        assertEquals(id, store.plexClientId)
        UUID.fromString(id)
    }

    @Test
    fun guestTokensArePerServerAndRoom() {
        val store = store()
        store.setGuestToken("g1", "http://a", "ABCD")
        assertEquals("g1", store.guestToken("http://a", "ABCD"))
        assertNull(store.guestToken("http://b", "ABCD"))
        store.setGuestToken(null, "http://a", "ABCD")
        assertNull(store.guestToken("http://a", "ABCD"))
    }

    @Test
    fun aDevelopmentPlexTvIsOnlyKeptInADebugBuild() {
        val settings = InMemoryKeyValueStore()
        store(settings = settings, debug = false).setPlexTvOverride("http://10.0.2.2:39313")
        assertNull(store(settings = settings, debug = true).current.plexTvOverride)
        store(settings = settings, debug = true).setPlexTvOverride("http://10.0.2.2:39313")
        assertEquals("http://10.0.2.2:39313", store(settings = settings, debug = true).current.plexTvOverride)
        assertNull(store(settings = settings, debug = false).current.plexTvOverride)
    }

    @Test
    fun theRolesNeedingASessionAreTheConnectedOnesWithout() {
        val store = store()
        store.setServer(PORTAL, "http://tb.lan:3100")
        store.setServer(ADMIN, "http://tb.lan:3000")
        assertEquals(listOf(PORTAL, ADMIN), store.current.rolesNeedingSession)
        store.setSession(PORTAL, "p")
        assertEquals(listOf(ADMIN), store.current.rolesNeedingSession)
    }

    @Test
    fun theLockComesBackAfterFiveMinutesAwayNotBefore() = runTest {
        val settings = InMemoryKeyValueStore().apply { setBool(AppLock.KEY, true) }
        var clock = 1_000_000L
        val lock = AppLock(settings) { clock }
        // A cold start with the lock on starts locked.
        assertTrue(lock.locked.value)

        val off = AppLock(settings) { clock }
        off.setEnabled(false) { true }
        assertFalse(off.locked.value)

        val warm = AppLock(InMemoryKeyValueStore().apply { setBool(AppLock.KEY, true) }) { clock }
        warm.markUnlocked()
        warm.didEnterBackground()
        clock += 4 * 60_000
        warm.willEnterForeground()
        assertFalse(warm.locked.value)
        warm.didEnterBackground()
        clock += AppLock.RELOCK_AFTER_MS
        warm.willEnterForeground()
        assertTrue(warm.locked.value)
    }

    @Test
    fun aLockThatCantBeOpenedIsNeverTurnedOn() = runTest {
        val settings = InMemoryKeyValueStore()
        val lock = AppLock(settings)
        assertFalse(lock.setEnabled(true) { false })
        assertFalse(lock.enabled.value)
        assertTrue(lock.setEnabled(true) { true })
        assertTrue(settings.bool(AppLock.KEY))
    }

    @Test
    fun onlyTheAdminsImageProxyGetsTheSession() {
        assertTrue(AdminImageAuth.isAdminImage("http://10.0.2.2:39311", "http://10.0.2.2:39311/api/plex-image?path=%2Fx"))
        assertFalse(AdminImageAuth.isAdminImage("http://10.0.2.2:39311", "http://10.0.2.2:39312/api/plex-image?path=%2Fx"))
        assertFalse(AdminImageAuth.isAdminImage("http://10.0.2.2:39311", "https://plex.tv/users/1/avatar"))
        assertFalse(AdminImageAuth.isAdminImage("http://10.0.2.2:39311", "http://10.0.2.2:39311/api/trpc/me"))
    }

    @Test
    fun appearanceDefaultsToDark() {
        val settings = InMemoryKeyValueStore()
        assertEquals(Appearance.DARK, AppSettings(settings).appearance.value)
        AppSettings(settings).setAppearance(Appearance.SYSTEM)
        assertEquals(Appearance.SYSTEM, AppSettings(settings).appearance.value)
    }
}
