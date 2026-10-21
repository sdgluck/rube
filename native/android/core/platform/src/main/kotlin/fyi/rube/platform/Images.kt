// Posters and thumbnails, through Coil.
//
// The admin's `/api/plex-image` proxy is an authenticated route — it spends
// the server's own Plex token, so it is gated like any admin call. The
// interceptor below adds the bearer to exactly those requests: same origin as
// the admin connection *and* that path. Portal posters are signed paths that
// need nothing, a user's avatar is an absolute plex.tv URL, and neither may
// ever be sent the admin's session.
package fyi.rube.platform

import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import fyi.rube.api.ServerAddress
import fyi.rube.api.ServerConnection
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response

/** Adds the admin session to the admin's image proxy, and to nothing else. */
class AdminImageAuth(private val admin: () -> ServerConnection?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = admin()?.takeIf { it.sessionToken != null && isAdminImage(it.baseUrl, request.url.toString()) }?.sessionToken
        return chain.proceed(if (token == null) request else request.newBuilder().header("Authorization", "Bearer $token").build())
    }

    companion object {
        fun isAdminImage(adminBase: String, url: String): Boolean {
            val parsed = url.toHttpUrlOrNull() ?: return false
            return ServerAddress.origin(url) == ServerAddress.origin(adminBase) && parsed.encodedPath == "/api/plex-image"
        }
    }
}

object Images {
    /** Installs the app-wide loader. Called once from `Application.onCreate`. */
    fun install(context: Context, admin: () -> ServerConnection?) {
        val http = OkHttpClient.Builder().addInterceptor(AdminImageAuth(admin)).build()
        SingletonImageLoader.setSafe { platform: PlatformContext ->
            ImageLoader.Builder(platform)
                .components { add(OkHttpNetworkFetcherFactory(callFactory = { http })) }
                .memoryCache { MemoryCache.Builder().maxSizePercent(platform, 0.2).build() }
                .diskCache { DiskCache.Builder().directory(context.cacheDir.resolve("images")).maxSizeBytes(256L shl 20).build() }
                .crossfade(true)
                .build()
        }
    }
}
