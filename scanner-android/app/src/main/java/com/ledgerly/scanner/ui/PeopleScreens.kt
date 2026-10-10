package com.ledgerly.scanner.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/* ───────────── Learners ───────────── */

@Composable
fun LearnersScreen() {
    val nav = LocalNav.current
    val m = LocalMe.current.obj
    val classes = m?.a("classes").objs()
    var cls by remember { mutableStateOf<String?>(null) }
    val chosen = cls ?: classes.firstOrNull()?.s("id")
    val res = rememberData(chosen?.let { "/api/v1/learn/captures/context?classId=$it" })
    val students = res.obj?.a("students").objs()
    var q by remember { mutableStateOf("") }
    val shown = students.filter { q.isBlank() || (it.s("name") ?: "").contains(q.trim(), ignoreCase = true) }
    Page("Learners", subtitle = "Writing, accuracy, weaknesses and achievements from scanned work") {
        if (classes.isNotEmpty()) item { ChoiceRow(classes.map { (it.s("id") ?: "") to (it.s("name") ?: "") }, chosen) { cls = it } }
        item { Field("Find a learner", q, { q = it }) }
        if (chosen == null) item { Empty("No classes", "You have no classes yet.") }
        else status(res, shown.isEmpty(), "No learners", "This class has no active learners in Ledgerly.")
        if (shown.isNotEmpty()) item {
            Card(padding = 8.dp) {
                shown.forEach { s -> ListRow(s.s("name") ?: "", s.s("admissionNumber"), leading = { Avatar(s.s("name") ?: "", 40.dp) }) { nav.navigate("learner/${s.s("id")}") } }
            }
        }
    }
}

@Composable
fun LearnerScreen(id: String) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val res = rememberData("/api/v1/learn/students/$id/overview")
    val o = res.obj
    var tab by remember { mutableIntStateOf(0) }
    Page("Learner", onBack = { nav.popBackStack() }) {
        if (o == null) { status(res, false, "", ""); return@Page }
        val st = o.o("student") ?: JSONObject()
        val ev = o.o("evidence") ?: JSONObject()
        val subjects = o.a("subjects").objs()
        val attempts = subjects.sumOf { it.i("attempts") }
        val accuracy = if (attempts == 0) null else subjects.sumOf { it.i("accuracyPct") * it.i("attempts") } / attempts
        val achievements = o.a("achievements").objs()
        item {
            Card(padding = 18.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(st.s("name") ?: "", 58.dp); Spacer(Modifier.width(14.dp))
                    Column {
                        Text(st.s("name") ?: "", style = MaterialTheme.typography.titleLarge)
                        Text(listOfNotNull(st.s("className"), st.s("stream"), st.s("admissionNumber")?.let { "ADM $it" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth()) {
                    Stat("${ev.i("pages")}", "pages read", Modifier.weight(1f))
                    Stat(accuracy?.let { "$it%" } ?: "—", "accuracy", Modifier.weight(1f))
                    Stat("${achievements.count { it.s("type") == "mastered" }}", "skills mastered", Modifier.weight(1f))
                }
            }
        }
        val improved = achievements.firstOrNull { it.s("type") == "improved" }
        val hw = o.o("handwriting")
        when {
            improved != null -> item { Notice(Icons.Filled.EmojiEvents, "Improving! ${improved.s("skill")}: from ${improved.i("fromPct")}% to ${improved.i("toPct")}%.", C.Warn, C.WarnSoft) }
            hw?.s("trend") == "improving" -> item { Notice(Icons.Filled.EmojiEvents, "Improving! Handwriting is getting better (${hw.s("level")}).", C.Warn, C.WarnSoft) }
        }
        if (ev.i("pages") == 0) item { Notice(Icons.Filled.AutoAwesome, "No scanned work yet. Scan this learner's books and Ledgerly AI fills in this overview.", C.Ai, C.AiSoft) }
        item { Tabs(listOf("Overview", "Writing", "Subjects"), tab) { tab = it } }
        when (tab) {
            0 -> {
                item {
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Ring((accuracy ?: 0) / 100f, accuracy?.let { "$it%" } ?: "—", C.Ok, 60.dp); Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Marked work", style = MaterialTheme.typography.titleSmall)
                                Text("$attempts answers marked · ${ev.s("firstScan")?.let { "since $it" } ?: "no scans yet"}", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                val weak = o.a("weaknesses").objs()
                if (weak.isNotEmpty()) {
                    item { SectionHeader("Needs help with") }
                    item { Card(padding = 8.dp) { weak.forEach { w -> ListRow(w.s("skill") ?: "", listOfNotNull(w.s("topic"), "${w.i("scorePct")}% · ${w.i("attempts")} tries").joinToString(" · "),
                        leading = { IconTile(Icons.Filled.TrendingDown, C.Warn, C.WarnSoft, 36.dp) }) } } }
                    item { SecondaryButton("Make a practice set →") { nav.navigate("practice") } }
                }
                if (achievements.isNotEmpty()) {
                    item { SectionHeader("Achievements") }
                    item { Card(padding = 8.dp) { achievements.forEach { a -> ListRow(a.s("skill") ?: "",
                        if (a.s("type") == "mastered") "Mastered · ${a.i("scorePct")}%" else "Improved ${a.i("fromPct")}% → ${a.i("toPct")}%",
                        leading = { IconTile(Icons.Filled.EmojiEvents, C.Ok, C.OkSoft, 36.dp) }) } } }
                }
                item { SectionHeader("Summary by Ledgerly AI") }
                item {
                    Card {
                        val sum = o.o("aiSummary")
                        if (sum != null) { Text(sum.s("summary") ?: sum.s("text") ?: sum.toString()); sum.s("generatedAt")?.let { Text("Written ${it.take(10)}", style = MaterialTheme.typography.bodySmall) } }
                        else Text("No summary yet.", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(8.dp))
                        SecondaryButton(if (sum == null) "Write a summary" else "Write a new summary") {
                            launchCall(scope, ctx, { ok -> if (ok) Toast.makeText(ctx, "Ledgerly AI is writing it. Open this page again in a minute.", Toast.LENGTH_LONG).show() }) {
                                api.post("/api/v1/learn/students/$id/summary", JSONObject())
                            }
                        }
                    }
                }
            }
            1 -> {
                listOf("handwriting" to "Handwriting", "spelling" to "Spelling", "language" to "Language", "presentation" to "Presentation").forEach { (k, label) ->
                    val d = o.o(k)
                    item {
                        Card {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                d?.s("level")?.let { Pill(it, C.Brand) }
                                d?.s("trend")?.let { Spacer(Modifier.width(6.dp)); Pill(it, if (it == "improving") C.Ok else if (it == "declining") C.Bad else C.Muted) }
                            }
                            if (d == null || d.i("samples") == 0) Text("Not enough scanned work yet.", style = MaterialTheme.typography.bodySmall)
                            d?.s("note")?.let { Spacer(Modifier.height(4.dp)); Text(it) }
                            if (k == "spelling") d?.a("commonMistakes").objs().takeIf { it.isNotEmpty() }?.let { list ->
                                Spacer(Modifier.height(6.dp)); Text("Often misspelt: " + list.joinToString(", ") { "${it.s("word")} (wrote \"${it.s("written")}\")" }, style = MaterialTheme.typography.bodySmall)
                            }
                            if (k == "language") d?.a("recurringIssues").objs().takeIf { it.isNotEmpty() }?.let { list ->
                                Spacer(Modifier.height(6.dp)); Text("Recurring: " + list.joinToString(", ") { it.s("issue") ?: "" }, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                o.a("teacherComments").objs().takeIf { it.isNotEmpty() }?.let { cs ->
                    item { SectionHeader("Teachers' comments") }
                    cs.forEach { c -> item { Card { Text("\"${c.s("comment")}\""); c.s("observedOn")?.let { Text(it, style = MaterialTheme.typography.bodySmall) } } } }
                }
            }
            else -> {
                if (subjects.isEmpty()) item { Empty("No marked work yet", "Accuracy per subject appears after exercise books are scanned.") }
                subjects.forEach { s ->
                    item {
                        Card {
                            Row { Text(s.s("subject") ?: "", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f)); Text("${s.i("accuracyPct")}%", fontWeight = FontWeight.Bold) }
                            Spacer(Modifier.height(6.dp)); Bar(s.i("accuracyPct") / 100f, if (s.i("accuracyPct") >= 60) C.Ok else C.Warn)
                            Text("${s.i("attempts")} answers marked", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                o.a("commonErrors").objs().takeIf { it.isNotEmpty() }?.let { es ->
                    item { SectionHeader("Usual mistakes") }
                    item { Card { es.forEach { e -> Text("•  ${e.s("errorType")?.replace('_', ' ')} (${e.i("times")}×)") } } }
                }
            }
        }
    }
}

/* ───────────── Coverage (DOS) ───────────── */

@Composable
fun CoverageScreen() {
    val nav = LocalNav.current
    val m = LocalMe.current.obj
    val classes = m?.a("classes").objs()
    var cls by remember { mutableStateOf<String?>(null) }
    val chosen = cls ?: classes.firstOrNull()?.s("id")
    val res = rememberData(chosen?.let { "/api/v1/learn/teaching/coverage?classId=$it" })
    val rows = res.arr.objs()
    Page("Coverage", onBack = { nav.popBackStack() }, subtitle = "Lessons taught against where the class should be") {
        if (classes.isNotEmpty()) item { ChoiceRow(classes.map { (it.s("id") ?: "") to (it.s("name") ?: "") }, chosen) { cls = it } }
        status(res, rows.isEmpty(), "Nothing to compare yet", "Coverage needs a published scheme for this class this term.")
        rows.forEach { r ->
            item {
                val lessons = r.i("lessons"); val taught = r.i("taught"); val behind = r.i("behindBy")
                Card(onClick = { nav.navigate("scheme/${r.s("schemeId")}") }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Ring(if (lessons == 0) 0f else taught.toFloat() / lessons, "$taught/$lessons", if (behind > 0) C.Warn else C.Ok, 56.dp); Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.s("subject") ?: "", style = MaterialTheme.typography.titleSmall)
                            Text("Should be at ${r.i("expectedByNow")} by now", style = MaterialTheme.typography.bodySmall)
                        }
                        if (behind > 0) Pill("$behind behind", C.Bad) else Pill("On track", C.Ok)
                    }
                }
            }
        }
    }
}

/* ───────────── Ledgerly AI engine (admin) ───────────── */

@Composable
fun EngineScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val res = rememberData("/api/v1/learn/engine")
    val e = res.obj
    fun set(body: JSONObject) = launchCall(scope, ctx, { res.reload() }) { api.put("/api/v1/learn/engine", body) }
    Page("Ledgerly AI engine", onBack = { nav.popBackStack() }, subtitle = "Writes schemes, notes and drawings; reads scanned pages") {
        if (e == null) { status(res, false, "", ""); return@Page }
        val s = e.o("settings") ?: JSONObject()
        val state = s.s("state") ?: "running"
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconTile(Icons.Filled.AutoAwesome, C.Ai, C.AiSoft, 46.dp); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(when (state) { "running" -> "Running"; "paused" -> "Paused"; else -> "Stopped" }, style = MaterialTheme.typography.titleMedium)
                        Text("Writing with ${if (s.s("provider") == "claude-code") "Claude" else "Codex"}", style = MaterialTheme.typography.bodySmall)
                    }
                    Pill(state, when (state) { "running" -> C.Ok; "paused" -> C.Warn; else -> C.Bad })
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(onClick = { set(JSONObject().put("state", "running")) }) { Icon(Icons.Filled.PlayArrow, "Start", tint = C.Ok) }
                    IconButton(onClick = { set(JSONObject().put("state", "paused")) }) { Icon(Icons.Filled.Pause, "Pause", tint = C.Warn) }
                    IconButton(onClick = { launchCall(scope, ctx, { res.reload() }) { api.post("/api/v1/learn/engine/stop", JSONObject()) } }) { Icon(Icons.Filled.Stop, "Stop", tint = C.Bad) }
                }
            }
        }
        item {
            Card {
                Text("Writer", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                ChoiceRow(listOf("codex" to "Codex", "claude-code" to "Claude"), s.s("provider")) { set(JSONObject().put("provider", it)) }
            }
        }
        val today = e.o("today")
        item {
            Card {
                Text("Today", style = MaterialTheme.typography.titleSmall)
                Text("${today?.i("steps") ?: 0} steps of ${s.i("dailyTaskLimit")} allowed · ${(today?.optLong("durationMs") ?: 0) / 60000} min of AI time", style = MaterialTheme.typography.bodySmall)
            }
        }
        val queue = e.a("queue").objs()
        if (queue.isNotEmpty()) {
            item { SectionHeader("Work queue") }
            item { Card { queue.forEach { q -> Text("${q.s("kind")}: ${q.i("n")} ${q.s("status")}", modifier = Modifier.padding(vertical = 2.dp)) } } }
        }
    }
}

/* ───────────── Ask Ledgerly AI ───────────── */

private data class Msg(val mine: Boolean, val text: String)

@Composable
fun AiScreen(initial: String?) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val msgs = remember { mutableStateListOf<Msg>() }
    var chatId by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf(initial ?: "") }
    var busy by remember { mutableStateOf(false) }
    fun send(t: String) {
        if (t.isBlank() || busy) return
        msgs.add(Msg(true, t.trim())); text = ""; busy = true
        launchCall(scope, ctx, { busy = false }) {
            val body = JSONObject().put("message", t.trim()).put("activeModule", "academics").apply { chatId?.let { put("chatId", it) } }
            val r = api.post("/api/v1/ledgerly-ai/chat", body)
            chatId = r.o("chat")?.s("id") ?: chatId
            msgs.add(Msg(false, r.o("message")?.s("content") ?: "…"))
        }
    }
    val examples = listOf("What is P5 learning in Science now?", "Give me 10 questions like 23 + 45", "Which classes are behind this week?", "Summarise how my class did in the last test")
    Page("Ask Ledgerly AI", onBack = { nav.popBackStack() }, subtitle = "Answers from the school's own records",
        bottom = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Field("Ask anything about teaching and learners", text, { text = it }, singleLine = false, modifier = Modifier.weight(1f))
                IconButton(onClick = { send(text) }, enabled = !busy && text.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = C.Brand) }
            }
        }) {
        if (msgs.isEmpty()) {
            item { FeaturedCard("Ledgerly AI", "How can I help today?", "Ask about lessons, the timetable, questions or a learner.", null, null) }
            examples.forEach { ex -> item { Card(onClick = { send(ex) }) { Text(ex) } } }
        }
        msgs.forEach { mm ->
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mm.mine) Arrangement.End else Arrangement.Start) {
                    Text(mm.text, color = if (mm.mine) Color.White else C.Ink, fontSize = 14.5.sp,
                        modifier = Modifier.widthIn(max = 310.dp).clip(RoundedCornerShape(18.dp)).background(if (mm.mine) C.Brand else Color.White).padding(12.dp, 9.dp))
                }
            }
        }
        if (busy) item { Text("Ledgerly AI is thinking…", style = MaterialTheme.typography.bodySmall) }
    }
}
