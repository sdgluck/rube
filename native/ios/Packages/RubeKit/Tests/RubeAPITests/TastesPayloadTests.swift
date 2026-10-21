// What the Tastes form sends: only the sections shown, and the two values
// that need saying explicitly to survive the server's merge.

import Foundation
import Testing
import RubeModels
@testable import RubeAPI

private let prefsJSON = #"{"genres":{"loved":["Drama"],"liked":[],"hated":["Horror"]},"people":{"lovedActors":[],"lovedDirectors":[],"avoided":[]},"eras":{"lovedDecades":[]},"watchedBias":"new_to_me","moods":["Cosy"],"excludedTitles":["Cats"],"excludedCollections":[],"strictHate":true,"digest":{"frequency":"never","email":"old@example.com"}}"#

private func components(digest: Bool = true, moods: Bool = true) -> Portal.ComponentsOutput {
    let json = #"{"action.keep":true,"action.notForMe":true,"tab.collections":true,"tab.leaving":true,"tab.match":true,"tab.tastes":true,"tastes.digest":\#(digest),"tastes.genres":true,"tastes.moods":\#(moods),"tastes.neverRecommend":true,"tastes.ratingFloor":true,"tastes.rowCount":true,"tastes.strictHate":true,"tastes.watchedBias":true}"#
    return try! JSONDecoder().decode(Portal.ComponentsOutput.self, from: Data(json.utf8))
}

private let prefs = try! JSONDecoder().decode(TastesPayload.Preferences.self, from: Data(prefsJSON.utf8))

@Test func onlyShownSectionsAreSent() throws {
    let out = try TastesPayload.make(prefs, components: components(moods: false))
    #expect(out["moods"] == nil)
    #expect(out["people"] == nil, "fields the form doesn't show are never sent")
    #expect(out["watchedBias"] == .string("new_to_me"))
    #expect(out["excludedTitles"] == .array([.string("Cats")]))
}

@Test func anyRatingIsSentAsZeroSoItClears() throws {
    #expect(try TastesPayload.make(prefs, components: components())["ratingFloor"] == .number(0))
}

@Test func unsubscribingClearsTheAddress() throws {
    guard case .object(let digest)? = try TastesPayload.make(prefs, components: components())["digest"] else {
        Issue.record("no digest"); return
    }
    #expect(digest["email"] == .string(""))
}

@Test func aDigestWithoutAnAddressIsHeldBack() {
    var p = prefs
    p.digest.frequency = .weekly
    p.digest.email = " "
    #expect(TastesPayload.digestNeedsEmail(p, components: components()))
    #expect(!TastesPayload.digestNeedsEmail(p, components: components(digest: false)))
}
