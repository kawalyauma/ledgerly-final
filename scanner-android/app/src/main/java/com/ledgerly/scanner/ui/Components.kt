package com.ledgerly.scanner.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A page with a title bar (back arrow when it is not a tab), a list body and an optional bottom button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Page(
    title: String, onBack: (() -> Unit)? = null, subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {}, bottom: (@Composable () -> Unit)? = null,
    body: LazyListScope.() -> Unit,
) {
    Scaffold(
        containerColor = C.Bg,
        topBar = {
            TopAppBar(
                title = { Column { Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) } } },
                navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = actions,
                colors = TopAppBarDefaults.topAppBarColors(containerColor = C.Bg),
            )
        },
        bottomBar = { bottom?.let { Box(Modifier.background(C.Bg).padding(16.dp, 8.dp, 16.dp, 14.dp)) { it() } } },
    ) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, pad.calculateTopPadding() + 4.dp, 16.dp, pad.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp), content = body)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 14.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Card).border(1.dp, C.Line, RoundedCornerShape(16.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(padding),
        content = content,
    )
}

/** The bold blue card at the top of Home and the lesson pages. */
@Composable
fun FeaturedCard(eyebrow: String, title: String, body: String?, action: String?, onClick: (() -> Unit)?) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Featured)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(18.dp),
    ) {
        Text(eyebrow.uppercase(), color = Color(0xFFDBE6FF), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp)
        Spacer(Modifier.height(6.dp))
        Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 27.sp)
        body?.let { Spacer(Modifier.height(6.dp)); Text(it, color = Color.White.copy(alpha = .9f), fontSize = 14.sp) }
        action?.let {
            Spacer(Modifier.height(12.dp))
            Text("$it  →", color = C.Brand, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color.White).padding(12.dp, 8.dp))
        }
    }
}

@Composable
fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) Text(action, color = C.Brand, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onAction))
    }
}

/** Round soft tile with an icon, like the category chips in the reference design. */
@Composable
fun IconTile(icon: ImageVector, tint: Color, bg: Color, size: Dp = 46.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(14.dp)).background(bg), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(size * .5f))
    }
}

@Composable
fun Pill(text: String, color: Color = C.Brand, bg: Color = color.copy(alpha = .12f)) {
    Text(text, color = color, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(bg).padding(9.dp, 3.dp))
}

/** Progress ring with the label in the middle (e.g. "33%" or "6/8"). */
@Composable
fun Ring(fraction: Float, label: String, color: Color = C.Brand, size: Dp = 56.dp, stroke: Dp = 6.dp) {
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = stroke.toPx(); val inset = w / 2
            val arc = Size(this.size.width - w, this.size.height - w)
            drawArc(color.copy(alpha = .15f), 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            drawArc(color, -90f, 360f * fraction.coerceIn(0f, 1f), false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        Text(label, fontWeight = FontWeight.Bold, fontSize = if (size < 50.dp) 11.sp else 13.sp, color = C.Ink)
    }
}

@Composable
fun Bar(fraction: Float, color: Color = C.Brand) {
    LinearProgressIndicator(progress = { fraction.coerceIn(0f, 1f) }, color = color, trackColor = color.copy(alpha = .14f),
        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), strokeCap = StrokeCap.Round, gapSize = 0.dp, drawStopIndicator = {})
}

@Composable
fun Avatar(name: String, size: Dp = 44.dp, bg: Color = C.BrandSoft, fg: Color = C.Brand) {
    val initials = name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(initials, color = fg, fontWeight = FontWeight.Bold, fontSize = (size.value * .36f).sp)
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick, modifier.fillMaxWidth().height(52.dp), enabled = enabled, shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = C.Brand)) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick, modifier.fillMaxWidth().height(48.dp), enabled = enabled, shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, C.Line)) { Text(text, style = MaterialTheme.typography.labelLarge, color = C.Brand) }
}

/** Loading, error and empty states for a list section. */
fun LazyListScope.status(l: Loaded, emptyWhen: Boolean, emptyTitle: String, emptyBody: String) {
    if (l.offline) item { Notice(Icons.Filled.CloudOff, l.error ?: "Offline", C.Warn, C.WarnSoft) }
    when {
        l.data == null && l.loading -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.Brand) } }
        l.data == null && l.error != null -> item {
            Card { Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ErrorOutline, null, tint = C.Bad); Spacer(Modifier.width(10.dp))
                Text(l.error, modifier = Modifier.weight(1f)); TextButton(onClick = l.reload) { Text("Retry") } } }
        }
        l.data != null && emptyWhen -> item { Empty(emptyTitle, emptyBody) }
    }
}

@Composable
fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(28.dp, 30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = C.Muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun Notice(icon: ImageVector, text: String, fg: Color, bg: Color, onClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp))
        Text(text, color = C.Ink, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
    }
}

/** A tappable row: leading tile, title, subtitle and a trailing element. */
@Composable
fun ListRow(title: String, subtitle: String? = null, leading: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        leading?.let { it(); Spacer(Modifier.width(12.dp)) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        trailing?.let { Spacer(Modifier.width(8.dp)); it() }
    }
}

/** Horizontal choice chips (classes, days, tabs). */
@Composable
fun ChoiceRow(options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit) {
    androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options.size) { i ->
            val (id, label) = options[i]
            val on = id == selected
            Text(label, color = if (on) Color.White else C.Ink, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp,
                modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(if (on) C.Brand else Color.White)
                    .border(1.dp, if (on) C.Brand else C.Line, RoundedCornerShape(20.dp)).clickable { onSelect(id) }.padding(14.dp, 8.dp))
        }
    }
}

/** Underlined tabs as in the reference lesson page (Lessons · About · Resources). */
@Composable
fun Tabs(tabs: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        tabs.forEachIndexed { i, t ->
            Column(Modifier.clickable { onSelect(i) }, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(t, color = if (i == selected) C.Brand else C.Muted, fontWeight = if (i == selected) FontWeight.Bold else FontWeight.Medium, fontSize = 14.5.sp)
                Spacer(Modifier.height(5.dp))
                Box(Modifier.height(2.5.dp).width(28.dp).clip(RoundedCornerShape(2.dp)).background(if (i == selected) C.Brand else Color.Transparent))
            }
        }
    }
}

@Composable
fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 19.sp, color = C.Ink)
        Text(label, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}
