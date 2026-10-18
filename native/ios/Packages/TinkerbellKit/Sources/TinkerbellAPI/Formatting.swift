// Small pieces of copy the web derives from data, ported so the app says the
// same thing: a room's filters as pills, a film's one-line meta, the Plex
// deep link. From `packages/contracts/src/match.ts` and
// `apps/portal/src/match/film.ts`.

import Foundation
import TinkerbellModels

public enum MatchText {
    /// "Comedy, Drama +1 · Under 2h · 2015 on".
    public static func pills(_ f: MatchFilters) -> [String] {
        var pills: [String] = []
        let genres = f.genres ?? []
        if !genres.isEmpty {
            pills.append(genres.count <= 2 ? genres.joined(separator: ", ") : "\(genres.prefix(2).joined(separator: ", ")) +\(genres.count - 2)")
        }
        if let max = f.maxMinutes, max > 0 {
            let total = Int(max)
            let (h, m) = (total / 60, total % 60)
            pills.append("Under \(h > 0 ? "\(h)h\(m > 0 ? " \(m)m" : "")" : "\(m)m")")
        }
        switch (f.minYear.map { Int($0) }, f.maxYear.map { Int($0) }) {
        case (let min?, let max?) where min > 0 && max > 0: pills.append("\(min)–\(max)")
        case (let min?, _) where min > 0: pills.append("\(min) on")
        case (_, let max?) where max > 0: pills.append("Before \(max + 1)")
        default: break
        }
        if let r = f.minRating { pills.append("Rated \(number(r))+") }
        if let r = f.maxRating { pills.append("Rated under \(number(r))") }
        return pills
    }

    public static func runtime(ms: Double?) -> String? {
        guard let ms, ms > 0 else { return nil }
        let mins = Int((ms / 60_000).rounded())
        let h = mins / 60
        return h > 0 ? "\(h)h \(mins % 60)m" : "\(mins)m"
    }

    /// "1999 · 7.8 · 2h 16m · R", skipping whatever the library doesn't know.
    public static func filmMeta(year: Int?, rating: Double?, durationMs: Double?, contentRating: String?) -> String {
        [
            year.map(String.init),
            rating.flatMap { $0 > 0 ? String(format: "%.1f", $0) : nil },
            runtime(ms: durationMs),
            contentRating.flatMap { $0.isEmpty ? nil : $0 },
        ].compactMap { $0 }.joined(separator: " · ")
    }

    /// Opens the film in Plex — the app if installed, app.plex.tv otherwise.
    public static func plexLink(serverID: String, ratingKey: String) -> URL? {
        let key = "/library/metadata/\(ratingKey)"
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        let encoded = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
        return URL(string: "https://app.plex.tv/desktop/#!/server/\(serverID)/details?key=\(encoded)")
    }

    static func number(_ d: Double) -> String {
        d == d.rounded() ? String(Int(d)) : String(d)
    }
}

public enum Durations {
    /// "3h 20m", "45m", "2d 4h" — watch time at a glance.
    public static func short(ms: Double) -> String {
        let minutes = Int(ms / 60_000)
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 48 { return "\(hours)h \(minutes % 60)m" }
        return "\(hours / 24)d \(hours % 24)h"
    }
}

/// `data:image/png;base64,…` — what the portal's branding background is when
/// the admin uploaded one rather than linking it.
public enum DataURL {
    public static func decode(_ raw: String) -> Data? {
        guard raw.hasPrefix("data:"), let comma = raw.firstIndex(of: ",") else { return nil }
        let header = raw[raw.index(raw.startIndex, offsetBy: 5)..<comma]
        let payload = String(raw[raw.index(after: comma)...])
        if header.hasSuffix(";base64") {
            return Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
        }
        return payload.removingPercentEncoding.map { Data($0.utf8) }
    }
}
