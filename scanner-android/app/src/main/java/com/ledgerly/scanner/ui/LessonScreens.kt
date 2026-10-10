package com.ledgerly.scanner.ui

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import coil3.compose.AsyncImage
import org.json.JSONObject
import java.io.File
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle as DayStyle
import java.util.Locale

/* ───────────── Lessons tab: schemes for my classes ───────────── */

@Composable
fun LessonsScreen() {
    val nav = LocalNav.current
    val m = LocalMe.current.obj
    val schemes = rememberData("/api/v1/learn/schemes?pageSize=200")
    val classes = m?.a("classes").objs()
    var cls by remember { mutableStateOf<String?>(null) }
    val mineIds = classes.mapNotNull { it.s("name") }.toSet()
    val list = schemes.arr.objs()
        .filter { m?.optBoolean("allClasses") != false || it.s("className") in mineIds }
        .filter { cls == null || it.s("className") == cls }
    val canWrite = m?.o("can")?.optBoolean("write") == true
    Page("Lessons", subtitle = "Schemes of work, notes and lesson plans by Ledgerly AI",
        actions = { if (canWrite) IconButton(onClick = { nav.navigate("newscheme") }) { Icon(Icons.Filled.Add, "New scheme", tint = C.Brand) } }) {
        if (classes.size > 1) item { ChoiceRow(listOf("" to "All classes") + classes.map { (it.s("name") ?: "") to (it.s("name") ?: "") }, cls ?: "") { cls = it.ifEmpty { null } } }
        item { Row(Modifier.fillMaxWidth()) { SecondaryButton("My timetable", Modifier.weight(1f)) { nav.navigate("timetable") } } }
        status(schemes, list.isEmpty(), "No schemes yet", if (canWrite) "Tap + to ask Ledgerly AI to write a scheme of work for a class and subject." else "The Director of Studies orders schemes; they appear here.")
        list.forEach { s -> item { SchemeCard(s) { nav.navigate("scheme/${s.s("id")}") } } }
    }
}

@Composable
private fun SchemeCard(s: JSONObject, onClick: () -> Unit) {
    val lessons = s.i("lessons"); val written = s.i("written")
    val (bg, fg) = C.tile(s.s("subjectName"))
    Card(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Filled.MenuBook, fg, bg, 48.dp); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("${s.s("subjectName")} · ${s.s("className")}", style = MaterialTheme.typography.titleMedium)
                Text("${s.s("termName") ?: ""} · $lessons lessons", style = MaterialTheme.typography.bodySmall)
            }
            SchemeStatus(s.s("status"))
        }
        Spacer(Modifier.height(10.dp))
        Bar(if (lessons == 0) 0f else written.toFloat() / lessons, fg)
        Spacer(Modifier.height(4.dp))
        Text("$written of $lessons lessons written" + if (s.i("failed") > 0) " · ${s.i("failed")} need another try" else "", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun SchemeStatus(status: String?) = when (status) {
    "published" -> Pill("Published", C.Ok)
    "review" -> Pill("Ready for review", C.Warn)
    "failed" -> Pill("Failed", C.Bad)
    "draft", "sourcing", "outlining", "writing" -> Pill("Ledgerly AI writing", C.Ai)
    else -> Pill(status ?: "", C.Muted)
}

/* ───────────── One scheme: units and lessons ───────────── */

@Composable
fun SchemeScreen(id: String) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val m = LocalMe.current.obj
    val res = rememberData("/api/v1/learn/schemes/$id")
    val s = res.obj
    var tab by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    val can = m?.o("can")
    Page(s?.let { "${it.s("subjectName")} · ${it.s("className")}" } ?: "Scheme", onBack = { nav.popBackStack() }, subtitle = s?.s("termName"),
        bottom = s?.let { sc -> {
            PrimaryButton(if (busy) "Preparing the Word file…" else "Download notes & lesson plans", enabled = !busy) {
                busy = true
                launchCall(scope, ctx, { busy = false }) {
                    val bytes = api.bytes("/api/v1/learn/schemes/$id/export.docx")
                    val f = File(File(ctx.cacheDir, "share").apply { mkdirs() }, "${sc.s("subjectName")}-${sc.s("className")}-${sc.s("termName")}.docx".replace(Regex("[^A-Za-z0-9.-]+"), "-"))
                    f.writeBytes(bytes)
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { shareFile(ctx, f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document") }
                }
            }
        } }) {
        if (s == null) { status(res, false, "", ""); return@Page }
        val lessons = s.a("lessons").objs()
        val written = lessons.count { it.s("status") == "written" }
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Ring(if (lessons.isEmpty()) 0f else written.toFloat() / lessons.size, "${if (lessons.isEmpty()) 0 else written * 100 / lessons.size}%", C.Brand, 60.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Scheme progress", style = MaterialTheme.typography.titleSmall)
                        Text("$written of ${lessons.size} lessons written · ${s.i("weeks")} weeks · ${s.i("periodsPerWeek")} periods a week", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(4.dp)); SchemeStatus(s.s("status"))
                    }
                }
            }
        }
        item { Tabs(listOf("Lessons", "About", "Sources"), tab) { tab = it } }
        when (tab) {
            0 -> {
                val units = s.a("units").objs()
                units.forEach { u ->
                    val inUnit = lessons.filter { it.s("unitId") == u.s("id") }
                    item { SectionHeader("${u.i("seq")}. ${u.s("title")}") }
                    item {
                        Card(padding = 8.dp) {
                            Text("Weeks ${u.i("weekFrom")}–${u.i("weekTo")}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(6.dp, 2.dp))
                            inUnit.forEach { l -> LessonRow(l) { nav.navigate("lesson/${l.s("id")}") } }
                        }
                    }
                }
                val loose = lessons.filter { l -> units.none { it.s("id") == l.s("unitId") } }
                if (loose.isNotEmpty()) item { Card(padding = 8.dp) { loose.forEach { l -> LessonRow(l) { nav.navigate("lesson/${l.s("id")}") } } } }
            }
            1 -> {
                item { Card { Text(s.s("title") ?: "", style = MaterialTheme.typography.titleSmall); s.s("summary")?.let { Spacer(Modifier.height(6.dp)); Text(it) } } }
                s.a("units").objs().forEach { u -> u.s("competences")?.let { c -> item { Card { Text(u.s("title") ?: "", style = MaterialTheme.typography.titleSmall); u.s("theme")?.let { Text(it, style = MaterialTheme.typography.bodySmall) }; Spacer(Modifier.height(6.dp)); Text(c) } } } }
                if (can?.optBoolean("write") == true) item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        val pending = lessons.count { it.s("status") != "written" }
                        if (pending > 0) SecondaryButton("Write the remaining $pending lessons") {
                            launchCall(scope, ctx, { if (it) { Toast.makeText(ctx, "Ledgerly AI is writing them, one lesson at a time.", Toast.LENGTH_LONG).show(); res.reload() } }) {
                                api.post("/api/v1/learn/schemes/$id/write", JSONObject().put("untilWeek", JSONObject.NULL))
                            }
                        }
                        if (can.optBoolean("manage")) {
                            if (s.s("status") == "published") SecondaryButton("Unpublish") { launchCall(scope, ctx, { res.reload() }) { api.post("/api/v1/learn/schemes/$id/unpublish", JSONObject()) } }
                            else if (s.s("status") == "review") PrimaryButton("Publish to teachers") { launchCall(scope, ctx, { res.reload() }) { api.post("/api/v1/learn/schemes/$id/publish", JSONObject()) } }
                        }
                    }
                }
            }
            else -> {
                val sources = s.a("sources").objs()
                if (sources.isEmpty()) item { Empty("No sources listed", "Ledgerly AI lists the e-library resources it used here.") }
                sources.forEach { src -> item { Card { Text(src.s("title") ?: "", style = MaterialTheme.typography.titleSmall); Text(listOfNotNull(src.s("role")?.replace('_', ' '), src.s("pageUrl")).joinToString(" · "), style = MaterialTheme.typography.bodySmall) } } }
            }
        }
    }
}

@Composable
private fun LessonRow(l: JSONObject, onClick: () -> Unit) {
    val st = l.s("status")
    ListRow(
        l.s("title") ?: "", listOfNotNull("Week ${l.i("week", 1)}", l.s("subtopic"), "${l.i("periods", 1)} period(s)", l.i("questions").takeIf { it > 0 }?.let { "$it questions" }).joinToString(" · "),
        leading = {
            val (bg, fg, icon) = when (st) {
                "written" -> Triple(C.Ok, Color.White, Icons.Filled.Check)
                "writing" -> Triple(C.Brand, Color.White, Icons.Filled.PlayArrow)
                else -> Triple(Color(0xFFEEF2F7), C.Muted, Icons.Filled.HourglassEmpty)
            }
            Box(Modifier.size(28.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) { Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp)) }
        },
        onClick = onClick,
    )
}

/* ───────────── One lesson: notes, plan, activity ───────────── */

@Composable
fun LessonScreen(id: String, planId: String?) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val m = LocalMe.current
    val res = rememberData("/api/v1/learn/lessons/$id")
    val qs = rememberData("/api/v1/learn/questions?lessonId=$id&pageSize=50")
    val l = res.obj
    var tab by remember { mutableIntStateOf(0) }
    var done by remember { mutableStateOf(false) }
    val scheme = rememberData(l?.s("schemeId")?.let { "/api/v1/learn/schemes/$it" })
    Page(l?.s("title") ?: "Lesson", onBack = { nav.popBackStack() }, subtitle = l?.let { listOfNotNull(it.s("unit"), "Week ${it.i("week", 1)}").joinToString(" · ") },
        bottom = if (l == null || m.obj?.o("can")?.optBoolean("write") != true) null else ({
            PrimaryButton(if (done) "Recorded as taught ✓" else "Mark lesson as taught", enabled = !done) {
                val sc = scheme.obj
                launchCall(scope, ctx, { ok -> if (ok) { done = true; m.reload(); Toast.makeText(ctx, "Recorded. Coverage is updated.", Toast.LENGTH_SHORT).show() } }) {
                    if (planId != null) api.post("/api/v1/learn/plan/$planId/status", JSONObject().put("status", "taught"))
                    if (sc != null) api.post("/api/v1/learn/teaching/events", JSONObject().put("classId", sc.s("classId")).put("subjectId", sc.s("subjectId"))
                        .put("lessonId", id).put("taughtOn", LocalDate.now().toString()).put("topic", l.s("unit") ?: l.s("title")).put("subtopic", l.s("title"))
                        .put("teacherStaffId", m.obj?.o("staff")?.s("id") ?: JSONObject.NULL))
                }
            }
        })) {
        if (l == null) { status(res, false, "", ""); return@Page }
        val diagrams = l.a("diagrams").objs()
        diagrams.firstOrNull()?.let { d -> item { Figure(api.baseUrl + d.s("url") + "?format=png", d.s("title"), 190) } }
        item { Tabs(listOf("Notes", "Lesson plan", "Activity"), tab) { tab = it } }
        when (tab) {
            0 -> {
                if (l.s("status") != "written" || l.s("notes") == null) item { Empty("Not written yet", "Ledgerly AI writes the notes lesson by lesson. Check back soon.") }
                else markdown(l.s("notes")!!, diagrams, api.baseUrl)
            }
            1 -> {
                item {
                    Card {
                        Text("Objectives", style = MaterialTheme.typography.titleSmall)
                        l.a("objectives").strs().forEach { Text("•  $it", modifier = Modifier.padding(top = 3.dp)) }
                        l.s("methods")?.let { Spacer(Modifier.height(10.dp)); Text("Methods", style = MaterialTheme.typography.titleSmall); Text(it) }
                        l.s("materials")?.let { Spacer(Modifier.height(10.dp)); Text("Materials", style = MaterialTheme.typography.titleSmall); Text(it) }
                        l.s("lifeSkills")?.let { Spacer(Modifier.height(10.dp)); Text("Life skills", style = MaterialTheme.typography.titleSmall); Text(it) }
                    }
                }
                l.o("lessonPlan")?.a("steps").objs().forEach { st ->
                    item {
                        Card {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(st.s("stage") ?: "", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Pill("${st.i("minutes")} min", C.Brand)
                            }
                            st.s("teacherActivity")?.let { Spacer(Modifier.height(6.dp)); Text("Teacher", color = C.Brand, fontWeight = FontWeight.SemiBold, fontSize = 12.sp); Text(it) }
                            st.s("learnerActivity")?.let { Spacer(Modifier.height(6.dp)); Text("Learners", color = C.Ok, fontWeight = FontWeight.SemiBold, fontSize = 12.sp); Text(it) }
                        }
                    }
                }
                l.s("assessment")?.let { a -> item { Card { Text("Assessment", style = MaterialTheme.typography.titleSmall); Text(a) } } }
            }
            else -> {
                val list = (qs.obj?.a("items") ?: qs.arr).objs()
                status(qs, list.isEmpty(), "No activity questions", "Questions for this lesson appear here once they are in the bank.")
                list.forEachIndexed { i, q ->
                    item {
                        Card(onClick = { nav.navigate("question/${q.s("id")}") }) {
                            Text("${i + 1}. ${q.s("stem")}", style = MaterialTheme.typography.bodyLarge)
                            q.s("answer")?.let { Spacer(Modifier.height(4.dp)); Text("Answer: $it", style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
                if (list.isNotEmpty()) item {
                    SecondaryButton("Make a practice set from this lesson") { nav.navigate("practice") }
                }
            }
        }
    }
}

@Composable
fun Figure(url: String, title: String?, height: Int = 220) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Line, RoundedCornerShape(16.dp)).padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        AsyncImage(url, title, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp, max = height.dp))
        title?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
    }
}

/** Renders the lesson notes (headings, bullets, tables, bold/italic, and [[diagram:key]] pictures). */
private fun androidx.compose.foundation.lazy.LazyListScope.markdown(md: String, diagrams: List<JSONObject>, base: String) {
    val lines = md.lines()
    var i = 0
    val para = StringBuilder()
    fun flush() { if (para.isNotBlank()) { val t = para.toString().trim(); item { Text(inline(t), style = MaterialTheme.typography.bodyLarge) } }; para.clear() }
    while (i < lines.size) {
        val raw = lines[i]; val line = raw.trim()
        when {
            line.isEmpty() -> flush()
            line.startsWith("[[diagram:") -> {
                flush()
                val key = line.removePrefix("[[diagram:").substringBefore("]]")
                diagrams.firstOrNull { it.s("key") == key }?.let { d -> item { Figure(base + d.s("url") + "?format=png", listOfNotNull(d.s("title"), d.s("caption")).joinToString(" — ")) } }
            }
            line.startsWith("#") -> {
                flush()
                val level = line.takeWhile { it == '#' }.length
                val t = line.drop(level).trim()
                item { Text(inline(t), style = when (level) { 1 -> MaterialTheme.typography.titleLarge; 2 -> MaterialTheme.typography.titleMedium; else -> MaterialTheme.typography.titleSmall },
                    color = if (level <= 2) C.Brand else C.Ink, modifier = Modifier.padding(top = 4.dp)) }
            }
            line.startsWith("|") -> {
                flush()
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && lines[i].trim().startsWith("|")) {
                    val cells = lines[i].trim().trim('|').split("|").map { it.trim() }
                    if (!cells.all { it.matches(Regex(":?-{2,}:?")) }) rows.add(cells)
                    i++
                }
                i--
                item {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, C.Line, RoundedCornerShape(12.dp)).background(Color.White)) {
                        rows.forEachIndexed { r, cells ->
                            Row(Modifier.fillMaxWidth().background(if (r == 0) C.BrandSoft else Color.White).padding(8.dp)) {
                                cells.forEach { c -> Text(inline(c), modifier = Modifier.weight(1f).padding(end = 6.dp), fontSize = 13.5.sp, fontWeight = if (r == 0) FontWeight.Bold else FontWeight.Normal) }
                            }
                        }
                    }
                }
            }
            line.startsWith("- ") || line.startsWith("* ") || line.matches(Regex("^\\d+[.)] .*")) -> {
                flush()
                val bullet = if (line[0].isDigit()) line.substringBefore(" ") else "•"
                val t = line.substringAfter(" ")
                item { Row(Modifier.padding(start = 4.dp)) { Text(bullet, modifier = Modifier.width(22.dp), color = C.Brand, fontWeight = FontWeight.Bold); Text(inline(t), style = MaterialTheme.typography.bodyLarge) } }
            }
            else -> para.append(raw).append(' ')
        }
        i++
    }
    flush()
}

private fun inline(t: String): AnnotatedString = buildAnnotatedString {
    var rest = t
    val re = Regex("(\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|_[^_]+_)")
    while (true) {
        val mm = re.find(rest) ?: break
        append(rest.substring(0, mm.range.first))
        val v = mm.value
        if (v.startsWith("**")) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(v.removeSurrounding("**")) }
        else withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(v.trim('*', '_')) }
        rest = rest.substring(mm.range.last + 1)
    }
    append(rest)
}

fun shareFile(ctx: android.content.Context, f: File, mime: String) {
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
    ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share or open"))
}

/* ───────────── Timetable: my week ───────────── */

@Composable
fun TimetableScreen() {
    val nav = LocalNav.current
    val m = LocalMe.current.obj
    val today = LocalDate.now()
    val monday = today.with(DayOfWeek.MONDAY)
    var weekOffset by remember { mutableIntStateOf(0) }
    val start = monday.plusWeeks(weekOffset.toLong())
    var day by remember { mutableStateOf(if (today.dayOfWeek.value <= 5) today else monday) }
    val staff = m?.o("staff")?.s("id")
    val teacher = if (m?.optBoolean("allClasses") == false && staff != null) "&teacherStaffId=$staff" else ""
    val res = rememberData("/api/v1/learn/plan?from=$start&to=${start.plusDays(6)}$teacher")
    val all = res.arr.objs()
    Page("Timetable", onBack = { nav.popBackStack() }, subtitle = "Week of ${start.dayOfMonth} ${start.month.getDisplayName(DayStyle.SHORT, Locale.getDefault())}",
        actions = {
            androidx.compose.material3.TextButton(onClick = { weekOffset--; day = day.minusWeeks(1) }) { Text("‹ Prev") }
            androidx.compose.material3.TextButton(onClick = { weekOffset++; day = day.plusWeeks(1) }) { Text("Next ›") }
        }) {
        item {
            ChoiceRow((0..5).map { start.plusDays(it.toLong()) }.map { it.toString() to "${it.dayOfWeek.getDisplayName(DayStyle.SHORT, Locale.getDefault())} ${it.dayOfMonth}" }, day.toString()) { day = LocalDate.parse(it) }
        }
        val list = all.filter { it.s("date") == day.toString() }
        status(res, list.isEmpty(), "Nothing planned", "No periods on this day, or the timetable is not published yet.")
        list.forEach { p ->
            item {
                val free = p.s("status") == "free"
                val (bg, fg) = C.tile(p.s("subject"))
                Card(onClick = p.s("lessonId")?.let { lid -> { nav.navigate("lesson/$lid?plan=${p.s("id")}") } }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.width(58.dp)) { Text(p.s("startsAt") ?: "", fontWeight = FontWeight.Bold); Text(p.s("endsAt") ?: "", style = MaterialTheme.typography.bodySmall) }
                        Box(Modifier.width(4.dp).height(44.dp).clip(RoundedCornerShape(2.dp)).background(if (free) C.Line else fg)); Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (free) "Free" else "${p.s("subject")} · ${p.s("className")}", style = MaterialTheme.typography.titleSmall, color = if (free) C.Muted else C.Ink)
                            if (!free) Text(listOfNotNull(p.s("subtopic") ?: p.s("topic"), if (p.i("parts", 1) > 1) "part ${p.i("part")} of ${p.i("parts")}" else null).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                        }
                        when (p.s("status")) { "taught" -> Pill("Taught", C.Ok); "missed" -> Pill("Missed", C.Bad); else -> if (!free) Icon(Icons.Filled.Schedule, null, tint = C.Muted) }
                    }
                }
            }
        }
    }
}

/* ───────────── New scheme (DOS / teacher) ───────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSchemeScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val c = rememberData("/api/v1/learn/captures/context").obj
    var cls by remember { mutableStateOf<JSONObject?>(null) }
    var sub by remember { mutableStateOf<JSONObject?>(null) }
    var weeks by remember { mutableStateOf("12") }
    var ppw by remember { mutableStateOf("5") }
    var first by remember { mutableStateOf("2") }
    var busy by remember { mutableStateOf(false) }
    Page("New scheme of work", onBack = { nav.popBackStack() }, subtitle = c?.o("term")?.s("name")?.let { "For $it" }) {
        item { Notice(Icons.Filled.MenuBook, "Ledgerly AI reads the curriculum, schemes, notes and past papers in the e-library, writes the outline for the whole term, then the notes and lesson plans week by week.", C.Ai, C.AiSoft) }
        item { Picker("Class", c?.a("classes").objs(), cls) { cls = it } }
        item { Picker("Subject", c?.a("subjects").objs(), sub) { sub = it } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Field("Weeks", weeks, { weeks = it.filter(Char::isDigit).take(2) }, modifier = Modifier.weight(1f), type = androidx.compose.ui.text.input.KeyboardType.Number)
            Field("Periods a week", ppw, { ppw = it.filter(Char::isDigit).take(2) }, modifier = Modifier.weight(1f), type = androidx.compose.ui.text.input.KeyboardType.Number)
        } }
        item { Field("Write notes now for the first … weeks", first, { first = it.filter(Char::isDigit).take(2) }, type = androidx.compose.ui.text.input.KeyboardType.Number) }
        item {
            PrimaryButton(if (busy) "Sending…" else "Ask Ledgerly AI to write it", enabled = !busy && cls != null && sub != null && c?.o("term") != null) {
                busy = true
                launchCall(scope, ctx, { ok -> busy = false; if (ok) { Toast.makeText(ctx, "Started. The scheme appears in Lessons while it is written.", Toast.LENGTH_LONG).show(); nav.popBackStack() } }) {
                    api.post("/api/v1/learn/schemes", JSONObject().put("termId", c!!.o("term")!!.s("id")).put("classId", cls!!.s("id")).put("subjectId", sub!!.s("id"))
                        .put("weeks", weeks.toIntOrNull()?.coerceIn(1, 20) ?: 12).put("periodsPerWeek", ppw.toIntOrNull()?.coerceIn(1, 20) ?: 5)
                        .apply { first.toIntOrNull()?.takeIf { it > 0 }?.let { put("writeUntilWeek", it.coerceAtMost(20)) } })
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Picker(label: String, options: List<JSONObject>, selected: JSONObject?, onSelect: (JSONObject) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }) {
        OutlinedTextField(selected?.s("name") ?: "", {}, readOnly = true, label = { Text(label) }, shape = RoundedCornerShape(14.dp),
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(unfocusedBorderColor = C.Line, unfocusedContainerColor = Color.White, focusedContainerColor = Color.White),
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable))
        ExposedDropdownMenu(open, { open = false }) {
            options.forEach { o -> DropdownMenuItem(text = { Text(o.s("name") ?: "") }, onClick = { onSelect(o); open = false }) }
        }
    }
}

@Suppress("unused") private val keepIcon = Icons.Filled.Download
