package com.ledgerly.scanner.ui

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
    val canWrite = m?.o("can")?.optBoolean("manage") == true
    Page("Lessons", subtitle = "Schemes of work, notes and lesson plans by Ledgerly AI",
        actions = { if (canWrite) IconButton(onClick = { nav.navigate("newscheme") }) { Icon(Icons.Filled.Add, "New scheme", tint = C.Brand) } }) {
        if (classes.size > 1) item { ChoiceRow(listOf("" to "All classes") + classes.map { (it.s("name") ?: "") to (it.s("name") ?: "") }, cls ?: "") { cls = it.ifEmpty { null } } }
        item { Row(Modifier.fillMaxWidth()) { SecondaryButton("My timetable", Modifier.weight(1f)) { nav.navigate("timetable") } } }
        status(schemes, list.isEmpty(), "No schemes yet", if (canWrite) "Tap + to generate the term's schemes for the classes you choose." else "The Director of Studies generates the schemes; they appear here.")
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
    var download by remember { mutableStateOf<Int?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val dos = m?.o("can")?.optBoolean("manage") == true
    // Refresh while Ledgerly AI is writing, so ticks appear without leaving the page.
    androidx.compose.runtime.LaunchedEffect(id) { while (true) { kotlinx.coroutines.delay(20_000); res.reload() } }
    Page(s?.let { "${it.s("subjectName")} · ${it.s("className")}" } ?: "Scheme", onBack = { nav.popBackStack() }, subtitle = s?.s("termName"),
        actions = { if (s != null) IconButton(onClick = { download = 0 }) { Icon(Icons.Filled.Download, "Download", tint = C.Brand) } },
        bottom = s?.let { { PrimaryButton("Download, share or print") { download = 0 } } }) {
        if (s == null) { status(res, false, "", ""); return@Page }
        val lessons = s.a("lessons").objs()
        val weeks = s.i("weeks", 10)
        val notes = lessons.count { it.s("status") == "written" || it.s("status") == "reviewed" }
        val plans = lessons.count { it.s("planStatus") == "written" }
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Ring(if (lessons.isEmpty()) 0f else (notes + plans).toFloat() / (2 * lessons.size), "${if (lessons.isEmpty()) 0 else (notes + plans) * 50 / lessons.size}%", C.Brand, 60.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${lessons.size} lessons · $weeks weeks · one a day, Mon–Fri", style = MaterialTheme.typography.titleSmall)
                        Text("Notes: $notes of ${lessons.size} · Lesson plans: $plans of ${lessons.size}", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(4.dp)); SchemeStatus(s.s("status"))
                    }
                }
            }
        }
        s.s("coverageNote")?.let { note -> item { Notice(Icons.Filled.MenuBook, note, C.Warn, C.WarnSoft) } }
        if (s.s("status") in setOf("draft", "sourcing", "outlining")) item { Notice(Icons.Filled.HourglassEmpty, "Ledgerly AI is reading the e-library and writing the term's scheme. The weeks appear here when it is ready.", C.Ai, C.AiSoft) }
        item { Tabs(listOf("Weeks", "Lessons", "About"), tab) { tab = it } }
        when (tab) {
            0 -> {
                if (dos) item { Text("Step 1: write a week's notes. Step 2: write that week's lesson plans (made from the notes).", style = MaterialTheme.typography.bodySmall) }
                (1..weeks).forEach { w ->
                    val inWeek = lessons.filter { it.i("week", 1) == w }
                    if (inWeek.isEmpty()) return@forEach
                    item { WeekCard(w, inWeek, dos, onDownload = { download = w }, onOpen = { nav.navigate("lesson/$it") }) { what ->
                        launchCall(scope, ctx, { ok -> if (ok) { Toast.makeText(ctx, "Week $w ${if (what == "notes") "notes" else "lesson plans"}: Ledgerly AI has started.", Toast.LENGTH_LONG).show(); res.reload() } }) {
                            api.post("/api/v1/learn/schemes/$id/weeks/$w/$what", JSONObject())
                        }
                    } }
                }
            }
            1 -> {
                s.a("units").objs().forEach { u ->
                    val inUnit = lessons.filter { it.s("unitId") == u.s("id") }
                    if (inUnit.isEmpty()) return@forEach
                    item { SectionHeader("${u.i("seq")}. ${u.s("title")}") }
                    item { Card(padding = 8.dp) {
                        Text("Weeks ${u.i("weekFrom")}–${u.i("weekTo")}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(6.dp, 2.dp))
                        inUnit.forEach { l -> LessonRow(l) { nav.navigate("lesson/${l.s("id")}") } }
                    } }
                }
            }
            else -> {
                item { Card { Text(s.s("title") ?: "", style = MaterialTheme.typography.titleSmall); s.s("summary")?.let { Spacer(Modifier.height(6.dp)); Text(it) } } }
                s.a("units").objs().forEach { u -> u.s("competences")?.let { c -> item { Card { Text(u.s("title") ?: "", style = MaterialTheme.typography.titleSmall); u.s("theme")?.let { Text(it, style = MaterialTheme.typography.bodySmall) }; Spacer(Modifier.height(6.dp)); Text(c) } } } }
                s.a("sources").objs().takeIf { it.isNotEmpty() }?.let { src ->
                    item { SectionHeader("Sources (e-library)") }
                    item { Card { src.forEach { x -> Text("•  ${x.s("title")}", modifier = Modifier.padding(vertical = 2.dp)) } } }
                }
                if (dos) item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (s.s("status") == "published") SecondaryButton("Unpublish") { launchCall(scope, ctx, { res.reload() }) { api.post("/api/v1/learn/schemes/$id/unpublish", JSONObject()) } }
                        else if (s.s("status") == "review" || s.s("status") == "writing") PrimaryButton("Publish to teachers") { launchCall(scope, ctx, { res.reload() }) { api.post("/api/v1/learn/schemes/$id/publish", JSONObject()) } }
                        SecondaryButton("Delete this scheme") { confirmDelete = true }
                    }
                }
            }
        }
    }
    if (download != null && s != null) DownloadDialog(id, "${s.s("subjectName")}-${s.s("className")}-${s.s("termName")}", s.i("weeks", 10),
        startWeek = download?.takeIf { it > 0 }) { download = null }
    if (confirmDelete) androidx.compose.material3.AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete this scheme?") },
        text = { Text("Its outline, notes and lesson plans are removed. You can then generate a new scheme for this class, subject and term.") },
        confirmButton = { androidx.compose.material3.TextButton(onClick = {
            confirmDelete = false
            launchCall(scope, ctx, { ok -> if (ok) nav.popBackStack() }) { api.delete("/api/v1/learn/schemes/$id") }
        }) { Text("Delete", color = C.Bad) } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
    )
}

/** One teaching week: its five lessons (Mon–Fri) with note and plan ticks, and the DOS's buttons for the next step. */
@Composable
private fun WeekCard(week: Int, lessons: List<JSONObject>, dos: Boolean, onDownload: () -> Unit, onOpen: (String) -> Unit, onRequest: (String) -> Unit) {
    val notesDone = lessons.count { it.s("status") == "written" || it.s("status") == "reviewed" }
    val notesBusy = lessons.any { it.s("status") == "writing" || (it.s("status") == "pending" && it.optBoolean("notesRequested")) }
    val plansDone = lessons.count { it.s("planStatus") == "written" }
    val plansBusy = lessons.any { it.s("planStatus") == "requested" || it.s("planStatus") == "writing" }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Week $week", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (notesDone + plansDone > 0) Text("Download", color = C.Brand, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickableNoRipple(onDownload).padding(6.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("Notes $notesDone/${lessons.size}", if (notesDone == lessons.size) C.Ok else if (notesBusy) C.Ai else C.Muted)
            Pill("Plans $plansDone/${lessons.size}", if (plansDone == lessons.size) C.Ok else if (plansBusy) C.Ai else C.Muted)
        }
        Spacer(Modifier.height(6.dp))
        lessons.sortedBy { it.i("seq") }.forEach { l ->
            Row(Modifier.fillMaxWidth().clickableNoRipple { onOpen(l.s("id")!!) }.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(DAYS[(l.i("day", 1) - 1).coerceIn(0, 4)], color = C.Muted, fontSize = 12.sp, modifier = Modifier.width(36.dp))
                Column(Modifier.weight(1f)) {
                    Text(l.s("title") ?: "", style = MaterialTheme.typography.bodyMedium, maxLines = 2)
                    KIND_LABEL[l.s("kind")]?.let { Text(it, color = C.Ai, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
                }
                Tick(l.s("status") == "written" || l.s("status") == "reviewed", l.s("status") == "writing", "N")
                Spacer(Modifier.width(4.dp))
                Tick(l.s("planStatus") == "written", l.s("planStatus") == "writing" || l.s("planStatus") == "requested", "P")
            }
        }
        if (dos) {
            Spacer(Modifier.height(8.dp))
            when {
                notesBusy -> Text("Ledgerly AI is writing this week's notes…", color = C.Ai, fontSize = 13.sp)
                notesDone < lessons.size -> PrimaryButton("Write week $week notes") { onRequest("notes") }
                plansBusy -> Text("Ledgerly AI is writing this week's lesson plans…", color = C.Ai, fontSize = 13.sp)
                plansDone < lessons.size -> PrimaryButton("Write week $week lesson plans") { onRequest("plans") }
                else -> Text("Notes and lesson plans ready ✓", color = C.Ok, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
        }
    }
}

private val DAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri")
val KIND_LABEL = mapOf("practice" to "Practice", "review" to "Weekly review", "revision" to "Revision", "assessment" to "End of term assessment")

@Composable
private fun Tick(done: Boolean, busy: Boolean, letter: String) {
    Box(Modifier.size(22.dp).clip(CircleShape).background(if (done) C.Ok else if (busy) C.AiSoft else Color(0xFFEEF2F7)), contentAlignment = Alignment.Center) {
        Text(if (done) "✓" else letter, color = if (done) Color.White else if (busy) C.Ai else C.Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit) = this.clickable(onClick = onClick)

@Composable
private fun LessonRow(l: JSONObject, onClick: () -> Unit) {
    val st = l.s("status")
    ListRow(
        l.s("title") ?: "", listOfNotNull("Week ${l.i("week", 1)} ${DAYS[(l.i("day", 1) - 1).coerceIn(0, 4)]}", l.s("subtopic"),
            if (l.s("planStatus") == "written") "plan ready" else null, l.i("questions").takeIf { it > 0 }?.let { "$it questions" }).joinToString(" · "),
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
    var download by remember { mutableStateOf(false) }
    Page(l?.s("title") ?: "Lesson", onBack = { nav.popBackStack() }, subtitle = l?.let { listOfNotNull(it.s("unit"), "Week ${it.i("week", 1)} · ${it.s("dayName") ?: ""}").joinToString(" · ") },
        actions = { if (l != null) IconButton(onClick = { download = true }) { Icon(Icons.Filled.Download, "Download", tint = C.Brand) } },
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
                if (l.o("lessonPlan") == null) item { Empty("Lesson plan not written yet", "The DOS asks Ledgerly AI for a week's lesson plans after that week's notes are written.") }
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
    val sc = scheme.obj
    if (download && l != null && sc != null) DownloadDialog(sc.s("id") ?: l.s("schemeId")!!, "${sc.s("subjectName")}-${sc.s("className")}-${sc.s("termName")}", sc.i("weeks", 10),
        lessonId = id, lessonLabel = "Lesson ${l.i("seq")}", startWeek = l.i("week", 1)) { download = false }
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

@Composable
fun NewSchemeScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val c = rememberData("/api/v1/learn/captures/context").obj
    val classes = remember { androidx.compose.runtime.mutableStateListOf<String>() }
    val subjects = remember { androidx.compose.runtime.mutableStateListOf<String>() }
    var busy by remember { mutableStateOf<String?>(null) }
    var checks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val extras = remember { androidx.compose.runtime.mutableStateMapOf<String, Set<String>>() }
    var report by remember { mutableStateOf<List<String>>(emptyList()) }
    val term = c?.o("term")
    val pairs = classes.flatMap { cl -> subjects.map { sb -> cl to sb } }
    val key = { x: JSONObject -> "${x.s("classId")}|${x.s("subjectId")}" }
    Page("Generate schemes", onBack = { nav.popBackStack() }, subtitle = term?.s("name")?.let { "For $it" },
        bottom = {
            if (checks.isEmpty()) PrimaryButton(busy ?: "Check e-library material (${pairs.size})", enabled = busy == null && pairs.isNotEmpty() && term != null) {
                busy = "Checking the e-library…"
                val out = mutableListOf<JSONObject>()
                launchCall(scope, ctx, { busy = null; checks = out.toList() }) {
                    for ((cl, sb) in pairs) {
                        val r = try { api.post("/api/v1/learn/schemes/preview", JSONObject().put("termId", term!!.s("id")).put("classId", cl).put("subjectId", sb)) }
                            catch (e: Exception) { JSONObject().put("error", e.message) }
                        out.add(r.put("classId", cl).put("subjectId", sb))
                    }
                }
            } else PrimaryButton(busy ?: "Generate ${checks.count { it.s("existingSchemeId") == null && it.s("error") == null }} scheme(s)", enabled = busy == null) {
                busy = "Starting…"
                val out = mutableListOf<String>()
                launchCall(scope, ctx, { busy = null; report = out.toList() }) {
                    for (x in checks.filter { it.s("existingSchemeId") == null && it.s("error") == null }) {
                        val label = "${x.s("subjectName")} · ${x.s("className")}"
                        try {
                            api.post("/api/v1/learn/schemes", JSONObject().put("termId", term!!.s("id")).put("classId", x.s("classId")).put("subjectId", x.s("subjectId"))
                                .put("library", JSONObject().put("extraSlugs", org.json.JSONArray((extras[key(x)] ?: emptySet()).toList()))))
                            out.add("✓ $label: started")
                        } catch (e: Exception) { out.add("• $label: ${e.message}") }
                    }
                }
            }
        }) {
        item { Notice(Icons.Filled.MenuBook, "One scheme per class and subject for the term: 10 weeks, one lesson a day Monday to Friday (50 lessons). Monday to Thursday teach and practise; every Friday reviews the week. You then ask for each week's notes, then its lesson plans.", C.Ai, C.AiSoft) }
        if (report.isNotEmpty()) {
            item { SectionHeader("Result") }
            item { Card { report.forEach { Text(it, modifier = Modifier.padding(vertical = 2.dp)) } } }
            item { SecondaryButton("Back to lessons") { nav.popBackStack() } }
            return@Page
        }
        if (checks.isNotEmpty()) {
            item { Text("Material found in the e-library. Tick extra resources to add them; Ledgerly uses them together with what it picked.", style = MaterialTheme.typography.bodySmall) }
            checks.forEach { x -> item { MaterialCard(x, extras[key(x)] ?: emptySet(), onOpen = { id -> nav.navigate("scheme/$id") }) { slug ->
                val cur = extras[key(x)] ?: emptySet(); extras[key(x)] = if (slug in cur) cur - slug else cur + slug } } }
            item { SecondaryButton("Change classes or subjects") { checks = emptyList() } }
            return@Page
        }
        if (term == null) item { Text("Loading classes…", style = MaterialTheme.typography.bodySmall) }
        item { SectionHeader("Classes") }
        item { MultiChips(c?.a("classes").objs(), classes) }
        item { SectionHeader("Subjects") }
        item { MultiChips(c?.a("subjects").objs(), subjects) }
        item { Text("For P1–P3, SST and Science material filed as Literacy One / Literacy Two is included automatically.", style = MaterialTheme.typography.bodySmall) }
    }
}

/** One class + subject: what Ledgerly found, how far it reaches, and resources the DOS can add. */
@Composable
private fun MaterialCard(x: JSONObject, chosen: Set<String>, onOpen: (String) -> Unit, onToggle: (String) -> Unit) {
    Card {
        Text("${x.s("subjectName") ?: ""} · ${x.s("className") ?: ""}", style = MaterialTheme.typography.titleMedium)
        x.s("error")?.let { Text(it, color = C.Bad); return@Card }
        x.s("existingSchemeId")?.let { id ->
            Text("Already has a scheme this term.", color = C.Warn, fontWeight = FontWeight.SemiBold)
            Text("Open it", color = C.Brand, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { onOpen(id) }.padding(vertical = 4.dp))
            return@Card
        }
        val lessons = x.i("teachingLessons"); val weeks = x.i("weeksCovered")
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 6.dp)) {
            Ring(weeks / 10f, "$weeks/10", if (weeks >= 10) C.Ok else if (weeks >= 5) C.Warn else C.Bad, 54.dp); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("About $lessons teaching lessons · weeks covered: $weeks of 10", style = MaterialTheme.typography.titleSmall)
                Text(x.s("advice") ?: "", style = MaterialTheme.typography.bodySmall)
            }
        }
        val picked = x.a("picked").objs()
        Text("Ledgerly will use (${picked.size}):", style = MaterialTheme.typography.titleSmall)
        if (picked.isEmpty()) Text("Nothing found automatically.", color = C.Bad, fontSize = 13.sp)
        picked.forEach { p -> Text("•  ${p.s("title")}  (${p.i("pages")} pages, ${p.s("role")?.replace('_', ' ')})", fontSize = 13.sp, modifier = Modifier.padding(vertical = 1.dp)) }
        val others = x.a("others").objs()
        if (others.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text("Add more from the e-library:", style = MaterialTheme.typography.titleSmall)
            others.forEach { o ->
                val slug = o.s("slug") ?: return@forEach
                Row(Modifier.fillMaxWidth().clickable { onToggle(slug) }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.Checkbox(slug in chosen, { onToggle(slug) })
                    Text("${o.s("title")}  (${o.i("pages")} pages${o.s("type")?.let { ", $it" } ?: ""})", fontSize = 13.sp, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun MultiChips(options: List<JSONObject>, chosen: MutableList<String>) {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { o ->
            val id = o.s("id") ?: return@forEach
            val on = id in chosen
            Text((if (on) "✓ " else "") + (o.s("name") ?: ""), color = if (on) Color.White else C.Ink, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp,
                modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(if (on) C.Brand else Color.White)
                    .border(1.dp, if (on) C.Brand else C.Line, RoundedCornerShape(20.dp)).clickable { if (on) chosen.remove(id) else chosen.add(id) }.padding(14.dp, 8.dp))
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
