// Posters and thumbnails.
//
// AsyncImage can't send a header, and the admin's `/api/plex-image` proxy is
// an authenticated route — it spends the server's own Plex token, so it is
// gated like any admin call. This loader adds the bearer to exactly the
// requests that ask for it (admin images); portal posters are signed paths
// that need nothing, and must not be sent the admin's session.
//
// URLCache keeps the bytes across launches; NSCache keeps decoded images for
// scrolling, so a list scrolled back up doesn't decode every row again.

import Foundation
import SwiftUI
import TinkerbellAPI
#if canImport(UIKit)
import UIKit
public typealias PlatformImage = UIImage
#else
import AppKit
public typealias PlatformImage = NSImage
#endif

public struct ImageRequest: Sendable, Hashable {
    public let url: URL
    /// Only for an admin-server image. Never set it for another origin.
    public let bearer: String?

    public init(url: URL, bearer: String? = nil) {
        self.url = url
        self.bearer = bearer
    }
}

public final class ImageLoader: Sendable {
    public static let shared = ImageLoader()

    let session: URLSession
    nonisolated(unsafe) let memory = NSCache<NSURL, PlatformImage>()

    public init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
        memory.countLimit = 300
    }

    public func cached(_ request: ImageRequest) -> PlatformImage? {
        memory.object(forKey: request.url as NSURL)
    }

    public func image(_ request: ImageRequest) async -> PlatformImage? {
        if let hit = cached(request) { return hit }
        let data: Data
        if request.url.scheme == "data" {
            guard let decoded = DataURL.decode(request.url.absoluteString) else { return nil }
            data = decoded
        } else {
            var urlRequest = URLRequest(url: request.url, timeoutInterval: 30)
            if let bearer = request.bearer { urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
            guard let (body, response) = try? await session.data(for: urlRequest),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
            else { return nil }
            data = body
        }
        guard let image = PlatformImage(data: data) else { return nil }
        memory.setObject(image, forKey: request.url as NSURL)
        return image
    }

    /// Fetch ahead — the next cards in a deck — so a swipe never reveals a
    /// blank one.
    public func prefetch(_ requests: [ImageRequest]) {
        for request in requests where cached(request) == nil {
            Task.detached(priority: .utility) { _ = await self.image(request) }
        }
    }
}

/// An image from the loader, with a quiet placeholder while it comes.
public struct RemoteImage<Placeholder: View>: View {
    let request: ImageRequest?
    let contentMode: ContentMode
    let placeholder: () -> Placeholder
    @State private var image: PlatformImage?

    public init(_ request: ImageRequest?, contentMode: ContentMode = .fill, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.request = request
        self.contentMode = contentMode
        self.placeholder = placeholder
        _image = State(initialValue: request.flatMap { ImageLoader.shared.cached($0) })
    }

    public var body: some View {
        Group {
            if let image {
                #if canImport(UIKit)
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                #else
                Image(nsImage: image).resizable().aspectRatio(contentMode: contentMode)
                #endif
            } else {
                placeholder()
            }
        }
        .task(id: request) {
            guard let request else { image = nil; return }
            if let hit = ImageLoader.shared.cached(request) { image = hit; return }
            let loaded = await ImageLoader.shared.image(request)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}

extension RemoteImage where Placeholder == PosterPlaceholder {
    public init(_ request: ImageRequest?, contentMode: ContentMode = .fill) {
        self.init(request, contentMode: contentMode) { PosterPlaceholder() }
    }
}

public struct PosterPlaceholder: View {
    public init() {}
    public var body: some View {
        Rectangle().fill(.quaternary).overlay {
            Image(systemName: "film").font(.title2).foregroundStyle(.tertiary)
        }
    }
}
