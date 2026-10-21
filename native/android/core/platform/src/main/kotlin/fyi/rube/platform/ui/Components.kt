// The small pieces every screen shares: notices, labelled rows, section
// headings, chip rows, images, relative times. Stock Material components with
// the app's defaults, so a new screen is built from these and looks like the rest.
package fyi.rube.platform.ui

import android.text.format.DateUtils
import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage

enum class Tone { INFO, WARNING, DANGER }

/** A one-line notice above a list: "Admin sign-in is off", "Not encrypted". */
@Composable
fun Notice(text: String, icon: ImageVector, tone: Tone = Tone.INFO, modifier: Modifier = Modifier) {
    val (container, content) = when (tone) {
        Tone.INFO -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
        Tone.WARNING -> MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
        Tone.DANGER -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }
    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = container, contentColor = content),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, contentDescription = null)
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** A list section's heading, in the primary colour as Material lists do. */
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 20.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** Label on the left, value on the right — iOS's LabeledContent, as a Material list row. */
@Composable
fun LabeledRow(label: String, value: String?, modifier: Modifier = Modifier, leading: ImageVector? = null, onClick: (() -> Unit)? = null) {
    ListItem(
        headlineContent = { Text(label) },
        trailingContent = value?.let { { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
        leadingContent = leading?.let { { Icon(it, contentDescription = null) } },
        modifier = if (onClick != null) modifier.clickableRow(onClick) else modifier,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

fun Modifier.clickableRow(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipFlow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) { content() }
}

/**
 * An image from Coil with a quiet placeholder while it comes. [model] is a
 * URL string, a decoded data URL's bytes, or null for "no picture".
 */
@Composable
fun RemoteImage(
    model: Any?,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    corner: Dp = 8.dp,
    contentScale: ContentScale = ContentScale.Crop,
    placeholder: @Composable () -> Unit = { PosterPlaceholder() },
) {
    Box(modifier.clip(RoundedCornerShape(corner))) {
        if (model == null) {
            placeholder()
        } else {
            SubcomposeAsyncImage(
                model = model,
                contentDescription = contentDescription,
                contentScale = contentScale,
                loading = { placeholder() },
                error = { placeholder() },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

@Composable
fun PosterPlaceholder(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Movie, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
    }
}


/** A person's initial in a circle, under their Plex avatar when it loads. */
@Composable
fun Avatar(url: String?, name: String, size: Dp = 40.dp) {
    RemoteImage(url, Modifier.size(size), corner = size / 2) {
        Box(Modifier.size(size).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
        }
    }
}

object Format {
    /** "5 min. ago" from a server timestamp in milliseconds. */
    fun relative(ms: Long?): String {
        if (ms == null) return "Never"
        return DateUtils.getRelativeTimeSpanString(ms, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
    }

    /** A timestamp as the locale writes a date and time. */
    @Composable
    fun dateTime(ms: Long): String = DateUtils.formatDateTime(
        LocalContext.current,
        ms,
        DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH,
    )

    @Composable
    fun date(ms: Long): String = DateUtils.formatDateTime(LocalContext.current, ms, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)

    @Composable
    fun bytes(n: Double): String = Formatter.formatShortFileSize(LocalContext.current, n.toLong())

    fun count(n: Number): String = java.text.NumberFormat.getIntegerInstance().format(n.toLong())

    fun plural(n: Long, one: String, many: String = one + "s"): String = "${count(n)} ${if (n == 1L) one else many}"
}
