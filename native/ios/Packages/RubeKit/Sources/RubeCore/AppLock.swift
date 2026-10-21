// Face ID (or the passcode) in front of the app.
//
// Opt-in, as it was in the retired Capacitor apps. The
// sessions already sit in the Keychain, so this guards against someone
// holding the unlocked phone, not against theft of a token — worth offering
// for an app that can empty a media library, not worth imposing on someone
// who only picks genres.
//
// Locks on a cold start and on return after five minutes away. Relocking on
// every app switch would make copying an address from Safari into the connect
// screen a Face ID prompt each way.

import Foundation
import LocalAuthentication
import Observation

@Observable
@MainActor
public final class AppLock {
    nonisolated public static let relockAfter: TimeInterval = 5 * 60

    public private(set) var isEnabled: Bool
    public private(set) var isLocked: Bool
    var backgroundedAt: Date?
    let defaults: UserDefaults
    let now: () -> Date
    nonisolated static let key = "tb.lock"

    public init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
        isEnabled = defaults.bool(forKey: Self.key)
        isLocked = defaults.bool(forKey: Self.key)
    }

    /// "Face ID", "Touch ID", "Optic ID" — or nil with no biometry enrolled,
    /// in which case the passcode alone still works.
    public var biometryName: String? {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return nil
        }
    }

    /// Any way to prove it's the owner — biometry or the device passcode.
    public var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// `.deviceOwnerAuthentication` so a failed face scan falls back to the
    /// passcode: the lock must never be a lockout from your own app.
    public func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }

    public func unlock() async {
        if await authenticate(reason: "Unlock Rube") { markUnlocked() }
    }

    func markUnlocked() { isLocked = false }

    /// Proves it works before relying on it: a lock you can't open is a
    /// lockout. Returns whether it is now on.
    @discardableResult
    public func setEnabled(_ on: Bool) async -> Bool {
        if on {
            guard await authenticate(reason: "Turn on the app lock") else { return isEnabled }
        }
        isEnabled = on
        defaults.set(on, forKey: Self.key)
        if !on { isLocked = false }
        return isEnabled
    }

    public func didEnterBackground() {
        backgroundedAt = now()
    }

    public func willEnterForeground() {
        defer { backgroundedAt = nil }
        guard isEnabled, let away = backgroundedAt else { return }
        if now().timeIntervalSince(away) >= Self.relockAfter { isLocked = true }
    }
}
