package com.ledgerly.scanner.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/** Questions opened from a list, so the question page shows them without another download. */
object Questions { val seen = mutableMapOf<String, JSONObject>() }

@Composable
fun BankScreen() {
    val nav = LocalNav.current
    val m = LocalMe.current.obj
    val classes = m?.a("classes").objs()
    var cls by remember { mutableStateOf<String?>(null) }
    var q by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var grouped by remember { mutableStateOf(false) }
    LaunchedEffect(q) { delay(350); query = q.trim() }
    val classParam = cls?.let { "&classId=$it" } ?: ""
    val list = rememberData(if (grouped) null else "/api/v1/learn/questions?pageSize=60$classParam${if (query.length >= 2) "&q=${enc(query)}" else ""}")
    val groups = rememberData(if (grouped) "/api/v1/learn/questions/groups?x=1$classParam" else null)
    Page("Question bank", subtitle = "From the e-library and from learners' books") {
        item { Field("Search questions", q, { q = it }) }
        if (classes.size > 1) item { ChoiceRow(listOf("" to "All classes") + classes.map { (it.s("id") ?: "") to (it.s("name") ?: "") }, cls ?: "") { cls = it.ifEmpty { null } } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Practice set", Modifier.weight(1f)) { nav.navigate("practice") }
                SecondaryButton("Image library", Modifier.weight(1f)) { nav.navigate("figures") }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Group similar questions", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                Switch(grouped, { grouped = it })
            }
        }
        if (grouped) {
            val gs = (groups.obj?.a("items") ?: groups.arr).objs()
            status(groups, gs.isEmpty(), "No groups yet", "Similar questions are grouped as the bank grows.")
            gs.forEach { g ->
                item {
                    Card {
                        Text(g.s("label") ?: "", style = MaterialTheme.typography.titleSmall)
                        Text(listOfNotNull(g.s("topic"), g.i("questions").takeIf { it > 0 }?.let { "$it questions" } ?: g.i("count").takeIf { it > 0 }?.let { "$it questions" }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall)
                        g.s("example")?.let { Spacer(Modifier.height(4.dp)); Text("e.g. $it") }
                    }
                }
            }
        } else {
            val items = (list.obj?.a("items") ?: list.arr).objs()
            status(list, items.isEmpty(), "No questions", "Questions arrive from the schemes Ledgerly AI writes and from scanned books.")
            items.forEach { x -> item { QuestionCard(x) { Questions.seen[x.s("id")!!] = x; nav.navigate("question/${x.s("id")}") } } }
        }
    }
}

@Composable
private fun QuestionCard(x: JSONObject, onClick: () -> Unit) {
    Card(onClick = onClick) {
        Text(x.s("stem") ?: "", style = MaterialTheme.typography.bodyLarge, maxLines = 4)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            x.s("groupLabel")?.let { Pill(it.substringBefore(" · "), C.Ai) }
            Pill(if (x.s("origin") == "capture") "From books" else "E-library", if (x.s("origin") == "capture") C.Teal else C.Brand)
            if (x.optBoolean("verified")) Icon(Icons.Filled.Verified, "Checked against the source", tint = C.Ok, modifier = Modifier.width(16.dp))
        }
    }
}

@Composable
fun QuestionScreen(id: String) {
    val nav = LocalNav.current
    val x = Questions.seen[id]
    var count by remember { mutableIntStateOf(5) }
    val alts = rememberData("/api/v1/learn/questions/$id/alternatives?count=$count")
    Page("Question", onBack = { nav.popBackStack() }) {
        x?.let {
            item {
                Card(padding = 18.dp) {
                    Text(it.s("stem") ?: "", style = MaterialTheme.typography.titleMedium)
                    it.s("answer")?.let { a -> Spacer(Modifier.height(10.dp)); Text("Answer", color = C.Ok, fontWeight = FontWeight.SemiBold, fontSize = 12.sp); Text(a) }
                    Spacer(Modifier.height(10.dp))
                    Text(listOfNotNull(it.s("topic"), it.s("subtopic"), it.s("kind")?.replace('_', ' '), it.i("difficulty").takeIf { d -> d > 0 }?.let { d -> "difficulty $d/5" }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall)
                    it.s("sourceTitle")?.let { s -> Text("Source: $s", style = MaterialTheme.typography.bodySmall) }
                    if (it.i("timesGiven") > 0) Text("Given ${it.i("timesGiven")} time(s)", style = MaterialTheme.typography.bodySmall)
                }
            }
            it.s("lessonId")?.let { l -> item { SecondaryButton("Open the lesson") { nav.navigate("lesson/$l") } } }
        }
        item { SectionHeader("Alternatives to give learners", "More") { count = (count + 5).coerceAtMost(50) } }
        val list = alts.arr.objs()
        status(alts, list.isEmpty(), "No alternatives yet", "Questions in the same group appear here as the bank grows.")
        list.forEach { a -> item { QuestionCard(a) { Questions.seen[a.s("id")!!] = a; nav.navigate("question/${a.s("id")}") } } }
    }
}

@Composable
fun PracticeScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val m = LocalMe.current.obj
    var cls by remember { mutableStateOf<JSONObject?>(null) }
    var sub by remember { mutableStateOf<JSONObject?>(null) }
    var count by remember { mutableStateOf("10") }
    var result by remember { mutableStateOf<JSONArray?>(null) }
    var busy by remember { mutableStateOf(false) }
    Page("Practice set", onBack = { nav.popBackStack() }, actions = {
        result?.let { r -> IconButton(onClick = { shareText(ctx, practiceText(cls?.s("name"), sub?.s("name"), r)) }) { Icon(Icons.Filled.Share, "Share", tint = C.Brand) } }
    }) {
        item { Notice(Icons.Filled.Quiz, "Ledgerly picks questions from the bank, spread across groups and least-used first.", C.Warn, C.WarnSoft) }
        item { Picker("Class", m?.a("classes").objs(), cls) { cls = it } }
        item { Picker("Subject (optional)", m?.a("subjects").objs(), sub) { sub = it } }
        item { Field("How many questions", count, { count = it.filter(Char::isDigit).take(3) }, type = androidx.compose.ui.text.input.KeyboardType.Number) }
        item {
            PrimaryButton(if (busy) "Picking…" else "Make the set", enabled = cls != null && !busy) {
                busy = true
                launchCall(scope, ctx, { busy = false }) {
                    val r = api.post("/api/v1/learn/questions/practice-set", JSONObject().put("classId", cls!!.s("id")).put("count", count.toIntOrNull()?.coerceIn(1, 100) ?: 10)
                        .apply { sub?.s("id")?.let { put("subjectId", it) } })
                    result = r.a("questions")
                }
            }
        }
        result?.let { r ->
            val qs = r.objs()
            if (qs.isEmpty()) item { Empty("No questions found", "There are no questions in the bank for this class yet.") }
            qs.forEachIndexed { i, x -> item { Card { Text("${i + 1}. ${x.s("stem")}", style = MaterialTheme.typography.bodyLarge); x.s("answer")?.let { Text("Answer: $it", style = MaterialTheme.typography.bodySmall) } } } }
            if (qs.isNotEmpty()) item { SecondaryButton("Share (WhatsApp, print…)") { shareText(ctx, practiceText(cls?.s("name"), sub?.s("name"), r)) } }
        }
    }
}

private fun practiceText(cls: String?, sub: String?, r: JSONArray): String {
    val qs = r.objs()
    return buildString {
        append("PRACTICE · ${listOfNotNull(cls, sub).joinToString(" · ")}\n\n")
        qs.forEachIndexed { i, x -> append("${i + 1}. ${x.s("stem")}\n\n") }
        append("ANSWERS\n")
        qs.forEachIndexed { i, x -> append("${i + 1}. ${x.s("answer") ?: "—"}\n") }
    }
}

fun shareText(ctx: android.content.Context, text: String) {
    ctx.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, text), "Share"))
}

/* ───────────── Image library ───────────── */

@Composable
fun FiguresScreen() {
    val nav = LocalNav.current
    val api = LocalApi.current
    var q by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(q) { delay(350); query = q.trim() }
    val res = rememberData("/api/v1/learn/figures?pageSize=100${if (query.length >= 2) "&q=${enc(query)}" else ""}")
    val list = res.arr.objs()
    Page("Image library", onBack = { nav.popBackStack() }, subtitle = "Drawn once, labelled any way, reused everywhere") {
        item { Field("Search drawings", q, { q = it }) }
        status(res, list.isEmpty(), "No drawings yet", "Drawings are added as Ledgerly AI writes lessons.")
        list.chunked(2).forEach { row ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { f ->
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Line, RoundedCornerShape(16.dp))
                            .clickable { nav.navigate("figure/${f.s("id")}") }.padding(10.dp)) {
                            AsyncImage("${api.baseUrl}/api/v1/learn/figures/${f.s("id")}/base.png", f.s("title"), contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxWidth().aspectRatio(1.2f))
                            Text(f.s("title") ?: "", style = MaterialTheme.typography.titleSmall, maxLines = 2)
                            Text("${f.i("parts")} parts · used ${f.i("uses")}×", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
fun FigureScreen(id: String) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val res = rememberData("/api/v1/learn/figures/$id")
    val f = res.obj
    var image by remember { mutableStateOf("${api.baseUrl}/api/v1/learn/figures/$id/base.png") }
    var key by remember { mutableStateOf<JSONObject?>(null) }
    var mode by remember { mutableStateOf("blank") }
    var busy by remember { mutableStateOf(false) }
    fun label(m: String) {
        busy = true; mode = m
        launchCall(scope, ctx, { busy = false }) {
            val r = api.post("/api/v1/learn/figures/$id/labelings", JSONObject().put("mode", m).put("seed", (1..1_000_000).random()))
            image = api.baseUrl + r.s("imageUrl"); key = r.o("answerKey")
        }
    }
    Page(f?.s("title") ?: "Drawing", onBack = { nav.popBackStack() }, subtitle = f?.s("subject")) {
        item { Figure(image, null, 320) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("names" to "Labelled", "letters" to "A, B, C", "blank" to "Blank").forEach { (m, label) ->
                    Box(Modifier.weight(1f)) { if (mode == m) PrimaryButton(label, enabled = !busy) { label(m) } else SecondaryButton(label, enabled = !busy) { label(m) } }
                }
            }
        }
        item { Text("\"A, B, C\" makes an exam version: the letters are shuffled each time and the answer key is shown below.", style = MaterialTheme.typography.bodySmall) }
        key?.let { k ->
            item {
                Card {
                    Text("Answer key", style = MaterialTheme.typography.titleSmall)
                    k.keys().asSequence().sorted().forEach { letter -> Text("$letter  —  ${k.optString(letter)}", modifier = Modifier.padding(top = 3.dp)) }
                }
            }
        }
        f?.let {
            item {
                Card {
                    Text("Parts", style = MaterialTheme.typography.titleSmall)
                    Text(it.a("anchors").objs().mapNotNull { a -> a.s("name") }.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item {
            SecondaryButton("Share this picture") {
                launchCall(scope, ctx) {
                    val bytes = api.bytes(image.removePrefix(api.baseUrl))
                    val file = java.io.File(java.io.File(ctx.cacheDir, "share").apply { mkdirs() }, "${(f?.s("title") ?: "drawing").replace(Regex("[^A-Za-z0-9]+"), "-")}-$mode.png")
                    file.writeBytes(bytes)
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { shareFile(ctx, file, "image/png") }
                }
            }
        }
    }
}

@Suppress("unused") private val keepIcon = Icons.Filled.Image
@Suppress("unused") private fun unusedToast(c: android.content.Context) = Toast.makeText(c, "", Toast.LENGTH_SHORT)
