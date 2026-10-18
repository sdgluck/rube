// Material 3 Expressive in Tinkerbell teal. Not dynamic colour: a wallpaper
// palette would replace the brand accent, and the accent is the one thing the
// app carries over from the web on purpose. The light scheme is built around
// #12867c, the dark around #1aa79b — the web's two accents — with the rest a
// hand-tuned tonal palette around them.
@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package dev.tinkerbell.platform.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import dev.tinkerbell.platform.Appearance

val TealLight = Color(0xFF12867C)
val TealDark = Color(0xFF1AA79B)

private val Light: ColorScheme = lightColorScheme(
    primary = TealLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFA6F2E6),
    onPrimaryContainer = Color(0xFF00201C),
    inversePrimary = Color(0xFF84D5CA),
    secondary = Color(0xFF4A635F),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCCE8E2),
    onSecondaryContainer = Color(0xFF05201C),
    tertiary = Color(0xFF456179),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFCCE5FF),
    onTertiaryContainer = Color(0xFF001E31),
    background = Color(0xFFF4FBF8),
    onBackground = Color(0xFF161D1C),
    surface = Color(0xFFF4FBF8),
    onSurface = Color(0xFF161D1C),
    surfaceVariant = Color(0xFFDAE5E1),
    onSurfaceVariant = Color(0xFF3F4947),
    surfaceTint = TealLight,
    inverseSurface = Color(0xFF2B3230),
    inverseOnSurface = Color(0xFFECF2EF),
    outline = Color(0xFF6F7977),
    outlineVariant = Color(0xFFBEC9C6),
    surfaceBright = Color(0xFFF4FBF8),
    surfaceDim = Color(0xFFD5DBD9),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFEEF5F2),
    surfaceContainer = Color(0xFFE9EFEC),
    surfaceContainerHigh = Color(0xFFE3EAE7),
    surfaceContainerHighest = Color(0xFFDDE4E1),
)

private val Dark: ColorScheme = darkColorScheme(
    primary = TealDark,
    onPrimary = Color(0xFF00201C),
    primaryContainer = Color(0xFF005049),
    onPrimaryContainer = Color(0xFFA6F2E6),
    inversePrimary = TealLight,
    secondary = Color(0xFFB1CCC6),
    onSecondary = Color(0xFF1C3531),
    secondaryContainer = Color(0xFF334B47),
    onSecondaryContainer = Color(0xFFCCE8E2),
    tertiary = Color(0xFFADCAE6),
    onTertiary = Color(0xFF153349),
    tertiaryContainer = Color(0xFF2D4961),
    onTertiaryContainer = Color(0xFFCCE5FF),
    background = Color(0xFF0E1514),
    onBackground = Color(0xFFDDE4E1),
    surface = Color(0xFF0E1514),
    onSurface = Color(0xFFDDE4E1),
    surfaceVariant = Color(0xFF3F4947),
    onSurfaceVariant = Color(0xFFBEC9C6),
    surfaceTint = TealDark,
    inverseSurface = Color(0xFFDDE4E1),
    inverseOnSurface = Color(0xFF2B3230),
    outline = Color(0xFF899390),
    outlineVariant = Color(0xFF3F4947),
    surfaceBright = Color(0xFF343B3A),
    surfaceDim = Color(0xFF0E1514),
    surfaceContainerLowest = Color(0xFF090F0F),
    surfaceContainerLow = Color(0xFF161D1C),
    surfaceContainer = Color(0xFF1A2120),
    surfaceContainerHigh = Color(0xFF252B2A),
    surfaceContainerHighest = Color(0xFF2F3635),
)

@Composable
fun Appearance.isDark(): Boolean = when (this) {
    Appearance.SYSTEM -> isSystemInDarkTheme()
    Appearance.DARK -> true
    Appearance.LIGHT -> false
}

@Composable
fun TinkerbellTheme(appearance: Appearance = Appearance.DARK, content: @Composable () -> Unit) {
    MaterialExpressiveTheme(
        colorScheme = if (appearance.isDark()) Dark else Light,
        motionScheme = MotionScheme.expressive(),
        content = content,
    )
}

/** Tones the scheme doesn't name: success, warning. Kept beside the scheme so they flip with it. */
object Tones {
    val success: Color @Composable @ReadOnlyComposable get() = if (MaterialTheme.colorScheme.surface == Dark.surface) Color(0xFF6DD58C) else Color(0xFF1E7A3C)
    val warning: Color @Composable @ReadOnlyComposable get() = if (MaterialTheme.colorScheme.surface == Dark.surface) Color(0xFFF5B649) else Color(0xFF9A5B00)
    val like: Color @Composable @ReadOnlyComposable get() = Color(0xFFE5487D)
}
