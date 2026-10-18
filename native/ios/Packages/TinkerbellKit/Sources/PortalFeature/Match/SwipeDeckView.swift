// The cards. One shared order per room (the server's), dealt in pages of what
// this member hasn't seen; swiping is optimistic, so the next card is there
// before the server has answered, and a swipe the server refused is put back
// — a swipe the room never heard about didn't happen. From
// `apps/portal/src/match/SwipeDeck.tsx`, with a drag gesture for the pointer
// events and haptics for the thump.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

typealias Film = Portal.MatchDeckOutput.Film

struct SwipeDeckView: View {
    let room: RoomContext
    let code: String
    let roomState: RoomState
    let onMatched: (String) -> Void
    let refresh: () async -> Void
    /// Asks the room to reset, which confirms first and rebuilds this view.
    let startOver: () -> Void

    @State private var cards: [Film] = []
    @State private var remaining: Int?
    @State private var last: (film: Film, liked: Bool)?
    @State private var error: String?
    @State private var dealing = false
    @State private var offset: CGSize = .zero
    @State private var flinging: Bool?
    @State private var likes = 0
    @State private var nopes = 0

    static let page = 20
    /// Fetch the next page when this few cards are left in hand.
    static let lowWater = 5
    /// How far a card travels before it counts as a swipe, not a wobble.
    static let threshold: CGFloat = 110

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                if cards.isEmpty {
                    if remaining == 0 { done } else { RoundedRectangle(cornerRadius: 20).fill(.quaternary).overlay { ProgressView() } }
                }
                if cards.count > 1 {
                    FilmCard(film: cards[1], poster: room.poster(cards[1].poster), likeAmount: 0)
                        .scaleEffect(0.95)
                        .allowsHitTesting(false)
                }
                if let top = cards.first {
                    FilmCard(film: top, poster: room.poster(top.poster), likeAmount: offset.width / Self.threshold)
                        .offset(offset)
                        .rotationEffect(.degrees(Double(offset.width / 18)))
                        .gesture(drag)
                        .id(top.ratingKey)
                        .accessibilityIdentifier("swipe-card")
                        .accessibilityActions {
                            Button("Like") { swipe(liked: true) }
                            Button("Skip") { swipe(liked: false) }
                        }
                }
            }
            .padding(.horizontal)
            .frame(maxHeight: .infinity)

            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }

            HStack(spacing: 28) {
                Button { swipe(liked: false) } label: { Image(systemName: "xmark").font(.title.bold()).frame(width: 64, height: 64) }
                    .buttonStyle(.bordered).buttonBorderShape(.circle).tint(.red)
                    .disabled(cards.isEmpty || flinging != nil)
                    .accessibilityLabel("Skip")
                    .accessibilityIdentifier("nope")
                Button("Undo", systemImage: "arrow.uturn.backward") { undo() }
                    .accessibilityIdentifier("undo")
                    .labelStyle(.iconOnly).font(.title3)
                    .buttonStyle(.bordered).buttonBorderShape(.circle)
                    .disabled(last == nil)
                Button { swipe(liked: true) } label: { Image(systemName: "heart.fill").font(.title.bold()).frame(width: 64, height: 64) }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.circle).tint(.pink)
                    .disabled(cards.isEmpty || flinging != nil)
                    .accessibilityLabel("Like")
                    .accessibilityIdentifier("like")
            }

            Text("\(roomState.me.liked) liked · \(roomState.me.swiped) of \(roomState.deckSize) films")
                .font(.footnote).foregroundStyle(.secondary)
                .padding(.bottom, 8)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: likes)
        .sensoryFeedback(.impact(weight: .light), trigger: nopes)
        .task { if remaining == nil { await deal() } }
        .onChange(of: cards.count) { _, count in
            if count < Self.lowWater, (remaining ?? 1) > 0 { Task { await deal() } }
            ImageLoader.shared.prefetch(cards.dropFirst().prefix(3).compactMap { room.poster($0.poster) })
        }
    }

    var done: some View {
        ContentUnavailableView {
            Label("That's every film in this room.", systemImage: "checkmark.seal")
        } description: {
            Text("See what everyone agreed on, or go round again.")
        } actions: {
            Button("Start Over") { startOver() }.buttonStyle(.bordered)
        }
    }

    var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                guard flinging == nil else { return }
                offset = value.translation
            }
            .onEnded { value in
                guard flinging == nil else { return }
                let travel = value.translation.width
                let predicted = value.predictedEndTranslation.width
                if abs(travel) > Self.threshold || (abs(travel) > 40 && abs(predicted) > 320) {
                    swipe(liked: travel > 0)
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { offset = .zero }
                }
            }
    }

    func swipe(liked: Bool) {
        guard flinging == nil, let film = cards.first else { return }
        if liked { likes += 1 } else { nopes += 1 }
        flinging = liked
        withAnimation(.easeIn(duration: 0.25)) {
            offset = CGSize(width: liked ? 700 : -700, height: offset.height + 40)
        } completion: {
            commit(film, liked: liked)
        }
    }

    func commit(_ film: Film, liked: Bool) {
        cards.removeAll { $0.ratingKey == film.ratingKey }
        offset = .zero
        flinging = nil
        last = (film, liked)
        Task {
            do {
                let result = try await room.client.call(PortalAPI.matchSwipe, .init(code: code, ratingKey: film.ratingKey, liked: liked))
                if result.matched { onMatched(film.ratingKey) }
                await refresh()
            } catch {
                cards.insert(film, at: 0)
                last = nil
                self.error = error.userMessage
            }
        }
    }

    func undo() {
        guard let (film, _) = last else { return }
        last = nil
        cards.removeAll { $0.ratingKey == film.ratingKey }
        cards.insert(film, at: 0)
        Task {
            do {
                _ = try await room.client.call(PortalAPI.matchUndo, .init(code: code, ratingKey: film.ratingKey))
                await refresh()
            } catch {
                self.error = error.userMessage
            }
        }
    }

    func deal() async {
        guard !dealing else { return }
        dealing = true
        defer { dealing = false }
        do {
            let held = cards.map(\.ratingKey)
            let page = try await room.client.call(PortalAPI.matchDeck, .init(code: code, exclude: held, limit: Self.page))
            let have = Set(held)
            cards.append(contentsOf: page.films.filter { !have.contains($0.ratingKey) })
            remaining = page.remaining - page.films.count
            error = nil
        } catch APIError.cancelled {
        } catch {
            self.error = error.userMessage
        }
    }
}

struct FilmCard: View {
    let film: Film
    let poster: ImageRequest?
    /// −1…1: how far toward Nope or Like the card has been dragged.
    let likeAmount: CGFloat

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(poster) {
                Rectangle().fill(.quaternary).overlay {
                    Text(film.title).font(.title.bold()).multilineTextAlignment(.center).padding()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()

            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)

            VStack(alignment: .leading, spacing: 6) {
                Text(film.title).font(.title2.bold())
                let meta = MatchText.filmMeta(year: film.year, rating: film.rating, durationMs: film.durationMs, contentRating: film.contentRating)
                if !meta.isEmpty { Text(meta).font(.subheadline) }
                if !film.genres.isEmpty {
                    Text(film.genres.prefix(3).joined(separator: " · ")).font(.caption.weight(.semibold))
                }
                if !film.summary.isEmpty {
                    Text(film.summary).font(.footnote).lineLimit(3).opacity(0.9)
                }
            }
            .foregroundStyle(.white)
            .padding()
        }
        .overlay(alignment: .topLeading) { stamp("LIKE", color: .green, angle: -12).opacity(max(0, min(1, likeAmount))) }
        .overlay(alignment: .topTrailing) { stamp("NOPE", color: .red, angle: 12).opacity(max(0, min(1, -likeAmount))) }
        .aspectRatio(2 / 3, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 20))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
    }

    func stamp(_ text: String, color: Color, angle: Double) -> some View {
        Text(text)
            .font(.largeTitle.weight(.heavy))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: 4) }
            .rotationEffect(.degrees(angle))
            .padding(24)
    }
}
#endif
