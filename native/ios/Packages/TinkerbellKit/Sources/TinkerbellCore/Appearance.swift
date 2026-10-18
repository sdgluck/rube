// Light, dark, or the system's. Dark by default: Tinkerbell is used with the
// lights down, next to a TV, and the web apps have always opened dark.

import Foundation
import Observation
import SwiftUI
import TinkerbellAPI

public enum Appearance: String, CaseIterable, Identifiable, Sendable {
    case system, dark, light
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }

    public var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }
}

@Observable
@MainActor
public final class AppSettings {
    static let appearanceKey = "tb.appearance"
    static let partKey = "tb.part"
    let defaults: UserDefaults

    public var appearance: Appearance {
        didSet { defaults.set(appearance.rawValue, forKey: Self.appearanceKey) }
    }

    /// Which half was open last, so an admin comes back where they were.
    public var lastPart: ServerProduct {
        didSet { defaults.set(lastPart.rawValue, forKey: Self.partKey) }
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        appearance = defaults.string(forKey: Self.appearanceKey).flatMap(Appearance.init(rawValue:)) ?? .dark
        lastPart = defaults.string(forKey: Self.partKey).flatMap(ServerProduct.init(rawValue:)) ?? .portal
    }
}
