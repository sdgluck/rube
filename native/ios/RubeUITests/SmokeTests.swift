// End-to-end smoke tests against `pnpm native:dev-server`: the seeded admin
// (39311), portal (39312) and mock plex.tv (39313) on this machine.
//
// Each test starts from a fresh install (`-TBResetState`), is handed the
// dev server's connect link (`-TBOpenURL`, as if a QR code had been scanned)
// and signs in headlessly as a seeded Plex account (`-TBDevSignInAs`), which
// approves the PIN on the mock instead of showing plex.tv's page. All three
// switches exist only in DEBUG builds.
//
// Set TEST_RUNNER_TB_SHOT_DIR to a directory to also save a PNG of each
// screen visited, for looking at the layout.

import XCTest

@MainActor
final class SmokeTests: XCTestCase {
    static let connectLink = "rube://connect?admin=http%3A%2F%2F127.0.0.1%3A39311&portal=http%3A%2F%2F127.0.0.1%3A39312&plexTv=http%3A%2F%2F127.0.0.1%3A39313"
    static let owner = "1"
    static let sharedUser = "101"

    func launch(as account: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-TBResetState", "YES", "-TBDevSignInAs", account, "-TBOpenURL", Self.connectLink]
        app.launch()
        return app
    }

    /// Confirm the link's servers, then sign in.
    func connectAndSignIn(_ app: XCUIApplication) {
        let connect = app.buttons["connect"]
        XCTAssertTrue(connect.waitForExistence(timeout: 15), "the connect screen")
        shot(app, "01-connect")
        // The probe runs on appear; the button waits on it.
        connect.tap()
        let signIn = app.buttons["sign-in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 20), "the sign-in screen")
        shot(app, "02-sign-in")
        signIn.tap()
    }

    func testOwnerSeesPortalThenSwitchesToAdmin() {
        let app = launch(as: Self.owner)
        connectAndSignIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30), "the portal's tab bar")
        for tab in ["Tastes", "Collections", "Match", "Leaving", "Account"] {
            XCTAssertTrue(tabs.buttons[tab].exists, "\(tab) tab")
        }
        shot(app, "03-portal-tastes")
        tabs.buttons["Collections"].tap()
        shot(app, "04-portal-collections")
        tabs.buttons["Leaving"].tap()
        shot(app, "05-portal-leaving")
        tabs.buttons["Account"].tap()
        shot(app, "06-portal-account")

        let menu = app.buttons["part-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertTrue(menu.label.contains("Admin"), "an admin can switch: \(menu.label)")
        menu.tap()
        app.buttons["Admin"].firstMatch.tap()

        XCTAssertTrue(app.navigationBars["Overview"].waitForExistence(timeout: 20), "the admin overview")
        XCTAssertTrue(app.staticTexts["Now playing"].waitForExistence(timeout: 10) || app.staticTexts["NOW PLAYING"].exists)
        shot(app, "07-admin-overview")
        let adminTabs = app.tabBars.firstMatch
        adminTabs.buttons["Jobs"].tap()
        _ = app.navigationBars["Jobs"].waitForExistence(timeout: 10)
        shot(app, "08-admin-jobs")
        adminTabs.buttons["Cleanup"].tap()
        shot(app, "09-admin-cleanup")
        adminTabs.buttons["Collections"].tap()
        _ = app.navigationBars["Collections"].waitForExistence(timeout: 10)
        sleep(2)
        shot(app, "10-admin-collections")
        adminTabs.buttons["Users"].tap()
        sleep(2)
        shot(app, "11-admin-users")
    }

    /// The whole of a room, from the owner's side: create it in the app, have
    /// a guest (played over HTTP by `DevServer`) like every film, then swipe,
    /// undo, match, vote and withdraw the vote, reset, and leave — checking
    /// each step against the server's own `match.state`.
    func testOwnerPlaysAMatchRoomEndToEnd() async throws {
        let app = launch(as: Self.owner)
        connectAndSignIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30))
        tabs.buttons["Match"].tap()
        let start = app.buttons["start-room"]
        XCTAssertTrue(start.waitForExistence(timeout: 15), "start a room")
        shot(app, "12-match-lobby")
        start.tap()
        let create = app.buttons["create-room"]
        XCTAssertTrue(create.waitForExistence(timeout: 15), "the new-room form")
        // Wait for the live count, so the room isn't started from an unknown deck.
        XCTAssertTrue(create.waitForLabel(containing: "films", timeout: 15), "the live count")
        shot(app, "13-match-new-room")
        create.tap()

        let roomBar = app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Room '")).firstMatch
        XCTAssertTrue(roomBar.waitForExistence(timeout: 20), "inside the room")
        let code = String(roomBar.identifier.dropFirst("Room ".count))

        // The second member: a guest who likes everything.
        let owner = DevServer.Credential.session(try await DevServer.portalSession(as: Self.owner))
        let before = try await DevServer.state(code, as: owner)
        let invite = try XCTUnwrap(before["invite"] as? String)
        _ = try await DevServer.guestWhoLikesEverything(code: code, invite: invite, name: "Gus")

        let like = app.buttons["like"], nope = app.buttons["nope"], undo = app.buttons["undo"]
        XCTAssertTrue(like.waitForExistence(timeout: 20), "the deck")
        let card = app.descendants(matching: .any).matching(identifier: "swipe-card").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10), "a card")
        sleep(1)
        shot(app, "14-match-deck")

        // Nope by dragging, then take it back: the same film is on top again.
        let firstTitle = card.label
        card.swipeLeft()
        sleep(1)
        XCTAssertTrue(undo.isEnabled, "undo after a swipe")
        undo.tap()
        sleep(1)
        XCTAssertEqual(card.label, firstTitle, "undo puts the card back")

        // A like the guest already gave is a match.
        like.tap()
        let seeMatches = app.buttons["See Matches"]
        XCTAssertTrue(seeMatches.waitForExistence(timeout: 15), "the match sheet")
        shot(app, "15-match-its-a-match")
        app.buttons["Keep Swiping"].tap()

        // A couple more: one nope by button, one like (another match, dismissed).
        XCTAssertTrue(nope.waitForExistence(timeout: 5))
        nope.tap()
        sleep(1)
        like.tap()
        if app.buttons["Keep Swiping"].waitForExistence(timeout: 10) { app.buttons["Keep Swiping"].tap() }
        sleep(1)
        let swiped = try await DevServer.state(code, as: owner)
        XCTAssertEqual((swiped["me"] as? [String: Any])?["swiped"] as? Int, 3, "three swipes landed after the undo")
        XCTAssertEqual(swiped["unanimousCount"] as? Int, 2, "two films everyone liked")

        // Vote, then withdraw it — the second tap sends ratingKey: null.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Matches'")).firstMatch.tap()
        let vote = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'vote-'")).firstMatch
        XCTAssertTrue(vote.waitForExistence(timeout: 10), "a film to vote for")
        let votedKey = String(vote.identifier.dropFirst("vote-".count))
        vote.tap()
        XCTAssertTrue(app.buttons["vote-\(votedKey)"].waitForLabel(containing: "Your pick", timeout: 10), "the vote shows")
        shot(app, "16-match-matches")
        let afterVote = try await DevServer.state(code, as: owner)
        XCTAssertEqual(afterVote["myVote"] as? String, votedKey)
        app.buttons["vote-\(votedKey)"].tap()
        XCTAssertTrue(app.buttons["vote-\(votedKey)"].waitForLabel(containing: "Watch this", timeout: 10), "the vote is withdrawn")
        let afterWithdraw = try await DevServer.state(code, as: owner)
        XCTAssertTrue(afterWithdraw["myVote"] is NSNull, "withdrawn on the server too")

        // Start over: the server forgets this member's swipes.
        app.buttons["room-options"].tap()
        app.buttons["Start Over"].firstMatch.tap()
        let confirmReset = app.sheets.buttons["Start Over"].exists ? app.sheets.buttons["Start Over"] : app.buttons.matching(identifier: "Start Over").element(boundBy: 0)
        XCTAssertTrue(confirmReset.waitForExistence(timeout: 5))
        confirmReset.tap()
        sleep(2)
        let afterReset = try await DevServer.state(code, as: owner)
        XCTAssertEqual((afterReset["me"] as? [String: Any])?["swiped"] as? Int, 0, "reset clears my swipes")
        XCTAssertTrue(like.waitForExistence(timeout: 10), "a fresh deck")

        // Leave: back in the lobby, and the room is no longer mine.
        app.buttons["room-options"].tap()
        app.buttons["Leave Room"].firstMatch.tap()
        let confirmLeave = app.sheets.buttons["Leave Room"].exists ? app.sheets.buttons["Leave Room"] : app.buttons.matching(identifier: "Leave Room").element(boundBy: 0)
        XCTAssertTrue(confirmLeave.waitForExistence(timeout: 5))
        confirmLeave.tap()
        XCTAssertTrue(start.waitForExistence(timeout: 15), "back in the lobby")
        let rooms = try await DevServer.query("match.rooms", [:], as: owner) as? [[String: Any]] ?? []
        XCTAssertFalse(rooms.contains { $0["code"] as? String == code }, "left room \(code)")
    }

    /// Someone with no account: opens an invite link on a fresh install,
    /// previews the room, gives a name, joins, swipes — and matches with the
    /// owner, who liked that film first (over HTTP).
    func testAGuestJoinsFromAnInviteLink() async throws {
        let owner = DevServer.Credential.session(try await DevServer.portalSession(as: Self.owner))
        let createdRaw = try await DevServer.mutate("match.create", ["sectionId": "1", "filters": [String: Any]()], as: owner)
        let created = try XCTUnwrap(createdRaw as? [String: Any])
        let code = try XCTUnwrap(created["code"] as? String), invite = try XCTUnwrap(created["invite"] as? String)
        let deckRaw = try await DevServer.query("match.deck", ["code": code, "exclude": [String](), "limit": 1], as: owner)
        let deck = try XCTUnwrap(deckRaw as? [String: Any])
        let first = try XCTUnwrap((deck["films"] as? [[String: Any]])?.first?["ratingKey"] as? String)
        _ = try await DevServer.mutate("match.swipe", ["code": code, "ratingKey": first, "liked": true], as: owner)

        continueAfterFailure = false
        let app = XCUIApplication()
        let server = DevServer.portal.absoluteString.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        app.launchArguments = ["-TBResetState", "YES", "-TBOpenURL", "rube://match?server=\(server)&code=\(code)&invite=\(invite)"]
        app.launch()

        let name = app.textFields["Your name"]
        XCTAssertTrue(name.waitForExistence(timeout: 20), "the guest join screen")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'owner'")).firstMatch.exists, "the preview names who's there")
        shot(app, "17-guest-join")
        name.tap()
        name.typeText("Gus")
        app.buttons["Join Room \(code)"].tap()

        let like = app.buttons["like"]
        XCTAssertTrue(like.waitForExistence(timeout: 20), "the guest's deck")
        sleep(2)
        shot(app, "18-guest-deck")
        like.tap()
        XCTAssertTrue(app.buttons["See Matches"].waitForExistence(timeout: 15), "a match with the owner")
        shot(app, "19-guest-its-a-match")
        app.buttons["See Matches"].tap()

        let members = (try await DevServer.state(code, as: owner)["members"] as? [[String: Any]]) ?? []
        XCTAssertTrue(members.contains { $0["name"] as? String == "Gus" && $0["guest"] as? Bool == true }, "the guest is in the room")
    }

    func testASharedUserHasNoAdminPart() {
        let app = launch(as: Self.sharedUser)
        connectAndSignIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30), "the portal's tab bar")
        let menu = app.buttons["part-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertFalse(menu.label.contains("Admin"), "no switch for a portal user: \(menu.label)")
        menu.tap()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Admin"].exists, "the menu offers no Admin part")
        shot(app, "20-shared-user-menu")
    }

    func shot(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["TB_SHOT_DIR"] {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appending(path: "\(name).png"))
        }
    }
}

extension XCUIElement {
    func waitForLabel(containing text: String, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if exists, label.contains(text) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return false
    }
}
