// The generated models against JSON as the server actually sends it.
//
// `codegen.test.ts` checks the generator wrote the right Swift; this checks
// that Swift decodes the right wire format — the half a source-text test
// can't see.

import Foundation
import Testing
@testable import TinkerbellModels

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(json.utf8))
}

private func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
}

@Test func aListDecodesIntoItsItems() throws {
    let items = try decode(Portal.LeavingSoonOutput.self, #"[{"ratingKey":"1","title":"Heat","runsRemaining":2,"voted":false}]"#)
    #expect(items.first?.title == "Heat")
    #expect(items.first?.runsRemaining == 2)
}

@Test func anEnumValueFromANewerServerStillDecodes() throws {
    #expect(try decode(Portal.PersonalizationStatusOutput.self, #""enabled""#) == .enabled)
    #expect(try decode(Portal.PersonalizationStatusOutput.self, #""paused""#) == .unknown("paused"))
    #expect(Portal.PersonalizationStatusOutput.unknown("paused").rawValue == "paused")
}

@Test func aUnionDecodesByItsDiscriminator() throws {
    let ok = try decode(Admin.AuthExchangeOutput.self, #"{"status":"ok","username":"sam","token":"t"}"#)
    guard case .ok(let signedIn) = ok else { Issue.record("expected .ok"); return }
    #expect(signedIn.token == "t")

    let open = try decode(Admin.AuthExchangeOutput.self, #"{"status":"open"}"#)
    guard case .open = open else { Issue.record("expected .open"); return }
}

@Test func aBooleanDiscriminatorWorksToo() throws {
    let refused = try decode(Admin.ProblemsRescanOutput.self, #"{"ok":false,"reason":"already-running"}"#)
    guard case .okFalse(let body) = refused else { Issue.record("expected .okFalse"); return }
    #expect(body.reason == .alreadyRunning)
}

@Test func anUnknownUnionTagIsAnError() {
    #expect(throws: DecodingError.self) {
        try decode(Admin.AuthExchangeOutput.self, #"{"status":"maybe"}"#)
    }
}

@Test func aRequiredNullableInputIsSentAsNull() throws {
    // `match.vote` with no film is "withdraw my vote" — the key must be there.
    let body = try encode(Portal.MatchVoteInput(code: "ABCD", ratingKey: nil))
    #expect(body.keys.contains("ratingKey"))
    #expect(body["ratingKey"] is NSNull)
}

@Test func anOptionalInputIsLeftOut() throws {
    let body = try encode(Portal.MatchJoinInput(code: "ABCD"))
    #expect(!body.keys.contains("invite"))
}

@Test func dottedKeysDecode() throws {
    let json = #"{"action.keep":true,"action.notForMe":false,"tab.collections":true,"tab.leaving":true,"tab.match":false,"tab.tastes":true,"tastes.digest":false,"tastes.genres":true,"tastes.moods":true,"tastes.neverRecommend":true,"tastes.ratingFloor":true,"tastes.rowCount":true,"tastes.strictHate":true,"tastes.watchedBias":true}"#
    let components = try decode(Portal.ComponentsOutput.self, json)
    #expect(components.tabMatch == false)
    #expect(components.actionKeep == true)
}
