// The stores against real UserDefaults suites and the real Keychain where the
// test process is allowed one.

import Foundation
import Testing
import RubeAPI
@testable import RubeCore

private func freshDefaults() -> UserDefaults {
    let name = "tb.tests.\(UUID().uuidString)"
    let d = UserDefaults(suiteName: name)!
    d.removePersistentDomain(forName: name)
    return d
}

@MainActor
@Test func connectionsPersistAddressesAndSessionsSeparately() {
    let secrets = InMemorySecretStore()
    let defaults = freshDefaults()
    let store = ConnectionStore(secrets: secrets, defaults: defaults)
    #expect(store.isEmpty)
    store.setServer(.portal, origin: "http://tb.lan:3100")
    store.setSession(.portal, token: "p-tok")
    store.setServer(.admin, origin: "http://tb.lan:3000")

    let reloaded = ConnectionStore(secrets: secrets, defaults: defaults)
    #expect(reloaded.portal?.sessionToken == "p-tok")
    #expect(reloaded.admin?.sessionToken == nil)
    // The token never lands in UserDefaults.
    #expect(!(defaults.dictionaryRepresentation().values.compactMap { $0 as? String }.contains("p-tok")))
}

@MainActor
@Test func aNewAddressDropsTheOldSession() {
    let store = ConnectionStore(secrets: InMemorySecretStore(), defaults: freshDefaults())
    store.setServer(.admin, origin: "http://a.lan:3000")
    store.setSession(.admin, token: "a-tok")
    store.setServer(.admin, origin: "http://a.lan:3000")
    #expect(store.admin?.sessionToken == "a-tok")
    store.setServer(.admin, origin: "http://b.lan:3000")
    #expect(store.admin?.sessionToken == nil)
}

@MainActor
@Test func aStale401DoesNotSignOutANewerSession() {
    let store = ConnectionStore(secrets: InMemorySecretStore(), defaults: freshDefaults())
    store.setServer(.portal, origin: "http://tb.lan:3100")
    store.setSession(.portal, token: "new")
    store.clearSession(.portal, ifToken: "old")
    #expect(store.portal?.sessionToken == "new")
    store.clearSession(.portal, ifToken: "new")
    #expect(store.portal?.sessionToken == nil)
    #expect(store.portal != nil)
}

@MainActor
@Test func openAdminIsRememberedAndClearedByAnUnauthorized() {
    let secrets = InMemorySecretStore()
    let defaults = freshDefaults()
    let store = ConnectionStore(secrets: secrets, defaults: defaults)
    store.setServer(.admin, origin: "http://tb.lan:3000")
    store.setSession(.admin, token: nil, openAuth: true)
    #expect(ConnectionStore(secrets: secrets, defaults: defaults).admin?.openAuth == true)
    #expect(store.admin?.isSignedIn == true)
    store.clearSession(.admin, ifToken: nil)
    #expect(store.admin?.isSignedIn == false)
}

@MainActor
@Test func thePlexClientIDIsMadeOnce() {
    let store = ConnectionStore(secrets: InMemorySecretStore(), defaults: freshDefaults())
    let id = store.plexClientID
    #expect(store.plexClientID == id)
    #expect(UUID(uuidString: id) != nil)
}

@MainActor
@Test func guestTokensArePerServerAndRoom() {
    let store = ConnectionStore(secrets: InMemorySecretStore(), defaults: freshDefaults())
    store.setGuestToken("g1", server: "http://a", code: "ABCD")
    #expect(store.guestToken(server: "http://a", code: "ABCD") == "g1")
    #expect(store.guestToken(server: "http://b", code: "ABCD") == nil)
    store.setGuestToken(nil, server: "http://a", code: "ABCD")
    #expect(store.guestToken(server: "http://a", code: "ABCD") == nil)
}

@MainActor
@Test func theLockComesBackAfterFiveMinutesAwayNotBefore() async {
    let defaults = freshDefaults()
    defaults.set(true, forKey: AppLock.key)
    var clock = Date(timeIntervalSince1970: 1_000)
    let lock = AppLock(defaults: defaults, now: { clock })
    // A cold start with the lock on starts locked.
    #expect(lock.isLocked)

    let unlocked = AppLock(defaults: defaults, now: { clock })
    await unlocked.setEnabled(false)
    #expect(!unlocked.isLocked)

    let warm = AppLock(defaults: freshDefaultsWithLock(), now: { clock })
    // Pretend it was unlocked.
    warm.markUnlocked()
    warm.didEnterBackground()
    clock += 4 * 60
    warm.willEnterForeground()
    #expect(!warm.isLocked)
    warm.didEnterBackground()
    clock += AppLock.relockAfter
    warm.willEnterForeground()
    #expect(warm.isLocked)
}

private func freshDefaultsWithLock() -> UserDefaults {
    let d = freshDefaults()
    d.set(true, forKey: AppLock.key)
    return d
}

// `swift test` runs unsigned, and the data-protection keychain wants an
// entitlement; where this process is refused one the test is skipped rather
// than failed, and the simulator build exercises the real store.
@Test(.enabled(if: KeychainStore(service: "fyi.rube.tests.probe").isUsable()))
func theKeychainRoundTrips() {
    let keychain = KeychainStore(service: "fyi.rube.tests.\(UUID().uuidString)")
    keychain.set("v1", for: "k")
    #expect(keychain.string(for: "k") == "v1")
    keychain.set("v2", for: "k")
    #expect(keychain.string(for: "k") == "v2")
    keychain.set(nil, for: "k")
    #expect(keychain.string(for: "k") == nil)
}
