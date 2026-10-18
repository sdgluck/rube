// Where the app keeps what would let somebody else be you: session tokens,
// the per-install Plex client id, movie-match guest tokens.
//
// The Keychain, `AfterFirstUnlockThisDeviceOnly`: readable once the phone has
// been unlocked since boot (so a sign-in survives the app being woken in the
// background), and never restored onto another device from a backup — a
// session that moved phones is a credential that left the device it was
// issued to, and signing in again there is one tap. UserDefaults is a plain
// file in the app's container and only ever holds addresses and switches.

import Foundation
import Security
import Synchronization

public protocol SecretStore: Sendable {
    func string(for key: String) -> String?
    func set(_ value: String?, for key: String)
}

public struct KeychainStore: SecretStore {
    public let service: String

    public init(service: String = "dev.tinkerbell.app") {
        self.service = service
    }

    func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            // The data-protection keychain on macOS too, so the item behaves
            // the same in `swift test` as on a phone.
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public func string(for key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        // An item that can't be read — restored to a new phone, where
        // ThisDeviceOnly items don't follow — is a signed-out app, not a crash.
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ value: String?, for key: String) {
        let q = query(key)
        SecItemDelete(q as CFDictionary)
        guard let value else { return }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    /// Whether this process can use the Keychain at all. A `swift test` run
    /// without a signing identity can't; tests use the in-memory store then.
    public func isUsable() -> Bool {
        let probe = "probe-\(UUID().uuidString)"
        set("1", for: probe)
        defer { set(nil, for: probe) }
        return string(for: probe) == "1"
    }
}

/// For previews and tests: the same contract, gone when the process ends.
public final class InMemorySecretStore: SecretStore {
    let values = Mutex<[String: String]>([:])
    public init() {}
    public func string(for key: String) -> String? { values.withLock { $0[key] } }
    public func set(_ value: String?, for key: String) { values.withLock { $0[key] = value } }
}
