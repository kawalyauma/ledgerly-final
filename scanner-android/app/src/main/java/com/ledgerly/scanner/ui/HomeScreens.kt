package com.ledgerly.scanner.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlaylistAddCheck
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ledgerly.scanner.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalTime

/* ───────────── Sign in ───────────── */

@Composable
fun LoginScreen(onDone: () -> Unit) {
    val api = LocalApi.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(api.baseUrl) }
    var user by remember { mutableStateOf(api.user ?: "") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var showServer by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().imePadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
        item {
            Spacer(Modifier.height(30.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(Icons.Filled.School, Color.White, C.Brand, 52.dp); Spacer(Modifier.width(12.dp))
                Column { Text("Ledgerly Academics", style = MaterialTheme.typography.headlineSmall); Text("Powered by Ledgerly AI", color = C.Ai, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
            }
            Spacer(Modifier.height(22.dp))
            Text("Teach today.\nTrack every learner.", fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
            Spacer(Modifier.height(8.dp))
            Text("Lessons and notes from Ledgerly AI · Timetable · Question bank · Book scanning · Learner progress", color = C.Muted, fontSize = 14.sp)
            Spacer(Modifier.height(26.dp))
            Card(padding = 18.dp) {
                Field("Email, username or phone", user, { user = it })
                Spacer(Modifier.height(10.dp))
                Field("Password", pass, { pass = it }, password = true)
                if (showServer) { Spacer(Modifier.height(10.dp)); Field("Ledgerly address", server, { server = it }, type = KeyboardType.Uri) }
                Spacer(Modifier.height(16.dp))
                PrimaryButton(if (busy) "Signing in…" else "Sign in", enabled = !busy && user.isNotBlank() && pass.isNotBlank()) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { api.baseUrl = server.trim().ifEmpty { "https://erp.notesug.com" }; api.login(user.trim(), pass) }
                            onDone()
                        } catch (e: Exception) { Toast.makeText(ctx, friendly(e), Toast.LENGTH_LONG).show() }
                        busy = false
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(if (showServer) "Hide server address" else "Change server address", color = C.Muted, fontSize = 13.sp,
                    modifier = Modifier.clickable { showServer = !showServer }.padding(4.dp))
            }
            Spacer(Modifier.height(18.dp))
            Text("Use the same account you use on Ledgerly. Ask the school's administrator if you don't have one.", color = C.Muted, fontSize = 13.sp)
        }
    }
}

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, password: Boolean = false, type: KeyboardType = KeyboardType.Text,
          singleLine: Boolean = true, modifier: Modifier = Modifier) {
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = singleLine, shape = RoundedCornerShape(14.dp), modifier = modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else type),
        colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = C.Line, focusedBorderColor = C.Brand, unfocusedContainerColor = Color.White, focusedContainerColor = Color.White))
}

/* ───────────── Home ───────────── */

private fun greeting(): String = when (LocalTime.now().hour) { in 0..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening" }

@Composable
fun HomeScreen() {
    val nav = LocalNav.current
    val me = LocalMe.current
    val m = me.obj
    val ctx = LocalContext.current
    // Keep "now teaching" current while the app stays open.
    LaunchedEffect(Unit) { while (true) { delay(120_000); me.reload() } }
    val unsent = remember(m) { Store.all(ctx).sumOf { b -> b.pages.count { it.status != "uploaded" } } }
    Page("") {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(Icons.Filled.School, Color.White, C.Brand, 40.dp); Spacer(Modifier.width(10.dp))
                Text("Ledgerly Academics", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { nav.navigate("profile") }) { Avatar(m?.o("user")?.s("name") ?: "", 38.dp) }
            }
        }
        item {
            val name = m?.o("user")?.s("name")?.split(" ")?.firstOrNull() ?: ""
            val term = m?.o("term")
            Text("${greeting()}${if (name.isNotEmpty()) ", $name" else ""} 👋", style = MaterialTheme.typography.headlineSmall)
            Text(listOfNotNull(m?.s("school"), term?.let { t -> if (t.optBoolean("inTerm")) "${t.s("name")} · Week ${t.i("week", 1)}" else "Holidays · last term: ${t.s("name")}" }).joinToString(" · ").ifEmpty { "Loading your day…" },
                color = C.Muted, fontSize = 14.sp)
        }
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White).clickable { nav.navigate("search") }.padding(14.dp, 13.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Search, null, tint = C.Muted); Spacer(Modifier.width(10.dp))
                Text("Search lessons, learners, questions…", color = C.Muted)
            }
        }
        if (m == null) { status(me, false, "", ""); return@Page }
        item { NowCard(m) }
        val plan = m.a("todayPlan").objs().filter { it.s("status") != "free" }
        item { SectionHeader("Today", "Timetable") { nav.navigate("timetable") } }
        item {
            if (plan.isEmpty()) Card { Text("No periods planned for you today.", fontWeight = FontWeight.SemiBold)
                Text("Once the DOS publishes the timetable, your periods and their subtopics appear here.", style = MaterialTheme.typography.bodySmall) }
            else LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(plan.size) { i -> PeriodChip(plan[i]) { plan[i].s("lessonId")?.let { id -> nav.navigate("lesson/$id?plan=${plan[i].s("id")}") } } }
            }
        }
        item { SectionHeader("Quick actions") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuickAction("Scan books", Icons.Filled.DocumentScanner, C.Teal, C.TealSoft, Modifier.weight(1f)) { nav.navigate("newbatch") }
                    QuickAction("Lessons", Icons.Filled.MenuBook, C.Brand, C.BrandSoft, Modifier.weight(1f)) { nav.navigate("lessons") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuickAction("Practice set", Icons.Filled.Quiz, C.Warn, C.WarnSoft, Modifier.weight(1f)) { nav.navigate("practice") }
                    QuickAction("Ask Ledgerly AI", Icons.Filled.AutoAwesome, C.Ai, C.AiSoft, Modifier.weight(1f)) { nav.navigate("ai") }
                }
            }
        }
        val stats = m.o("stats")
        val can = m.o("can")
        val alerts = buildList {
            if (unsent > 0) add(Triple("$unsent scanned page(s) waiting to be sent", Icons.Filled.DocumentScanner, "scan"))
            if ((stats?.i("pagesToReview") ?: 0) > 0) add(Triple("${stats!!.i("pagesToReview")} scanned page(s) need a learner's name", Icons.Filled.RateReview, "scan"))
            if (can?.optBoolean("manage") == true && (stats?.i("schemesToReview") ?: 0) > 0) add(Triple("${stats!!.i("schemesToReview")} scheme(s) written by Ledgerly AI are ready for review", Icons.Filled.PlaylistAddCheck, "lessons"))
        }
        if (alerts.isNotEmpty()) {
            item { SectionHeader("Needs attention") }
            alerts.forEach { (text, icon, route) -> item { Notice(icon, text, C.Warn, C.WarnSoft) { nav.navigate(route) } } }
        }
        if (can?.optBoolean("manage") == true) {
            item { SectionHeader("School") }
            item {
                Card(padding = 6.dp) {
                    MenuRow("Coverage: who is behind", Icons.Filled.Insights, C.Ok, C.OkSoft) { nav.navigate("coverage") }
                    MenuRow("Schemes of work", Icons.Filled.MenuBook, C.Brand, C.BrandSoft) { nav.navigate("lessons") }
                    MenuRow("Image library", Icons.Filled.Image, C.Teal, C.TealSoft) { nav.navigate("figures") }
                    if (can.optBoolean("admin")) MenuRow("Ledgerly AI engine", Icons.Filled.Settings, C.Ai, C.AiSoft) { nav.navigate("engine") }
                }
            }
        }
        item { WeekCard(m) }
    }
}

@Composable
private fun NowCard(m: JSONObject) {
    val nav = LocalNav.current
    val now = m.o("nowPeriod"); val next = m.o("nextPeriod")
    val p = now ?: next
    if (p == null) {
        FeaturedCard("Ledgerly AI", "Your lessons are ready", "Open a class to read the notes, the drawings and the activities for each lesson.", "Open lessons") { nav.navigate("lessons") }
        return
    }
    val part = if (p.i("parts", 1) > 1) " · part ${p.i("part", 1)} of ${p.i("parts")}" else ""
    FeaturedCard(
        "${if (now != null) "Now" else "Next"} · ${p.s("className") ?: ""} · ${p.s("startsAt")}–${p.s("endsAt")}",
        "${p.s("subject") ?: ""}\n${p.s("subtopic") ?: p.s("topic") ?: "Free period"}",
        listOfNotNull(p.s("topic")?.takeIf { p.s("subtopic") != null }, part.ifEmpty { null }?.trim(' ', '·')).joinToString(" · ").ifEmpty { null },
        if (p.s("lessonId") != null) "Open lesson" else null,
    ) { p.s("lessonId")?.let { nav.navigate("lesson/$it?plan=${p.s("id")}") } }
}

@Composable
private fun PeriodChip(p: JSONObject, onClick: () -> Unit) {
    val (bg, fg) = C.tile(p.s("subject"))
    Column(Modifier.width(150.dp).clip(RoundedCornerShape(16.dp)).background(Color.White).clickable(onClick = onClick).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(5.dp)).background(fg)); Spacer(Modifier.width(6.dp))
            Text("${p.s("startsAt")}–${p.s("endsAt")}", fontSize = 12.sp, color = C.Muted)
        }
        Spacer(Modifier.height(4.dp))
        Text(p.s("subject") ?: "", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = fg)
        Text(p.s("className") ?: "", fontSize = 12.sp, color = C.Muted)
        Text(p.s("subtopic") ?: p.s("topic") ?: "", fontSize = 12.5.sp, maxLines = 2, modifier = Modifier.padding(top = 2.dp))
        if (p.s("status") == "taught") Pill("Taught", C.Ok)
    }
}

@Composable
private fun QuickAction(label: String, icon: ImageVector, fg: Color, bg: Color, modifier: Modifier, onClick: () -> Unit) {
    Row(modifier.clip(RoundedCornerShape(16.dp)).background(Color.White).clickable(onClick = onClick).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, fg, bg, 38.dp); Spacer(Modifier.width(10.dp)); Text(label, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
    }
}

@Composable
fun MenuRow(label: String, icon: ImageVector, fg: Color, bg: Color, sub: String? = null, onClick: () -> Unit) {
    ListRow(label, sub, leading = { IconTile(icon, fg, bg, 38.dp) }, trailing = { Icon(Icons.Filled.ChevronRight, null, tint = C.Muted) }, onClick = onClick)
}

@Composable
private fun WeekCard(m: JSONObject) {
    val w = m.o("week") ?: return
    val planned = w.i("planned"); val taught = w.i("taught")
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Ring(if (planned == 0) 0f else taught.toFloat() / planned, "$taught/$planned", C.Ok, 60.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("This week's periods", style = MaterialTheme.typography.titleSmall)
                Text(if (planned == 0) "No timetable published yet" else "$taught taught · ${planned - taught} still to teach so far", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/* ───────────── Profile ───────────── */

@Composable
fun ProfileScreen(onSignOut: () -> Unit) {
    val nav = LocalNav.current
    val api = LocalApi.current
    val ctx = LocalContext.current
    val m = LocalMe.current.obj
    var confirm by remember { mutableStateOf(false) }
    Page("Profile", onBack = { nav.popBackStack() }) {
        item {
            Card(padding = 18.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(m?.o("user")?.s("name") ?: api.user ?: "", 60.dp); Spacer(Modifier.width(14.dp))
                    Column {
                        Text(m?.o("user")?.s("name") ?: api.user ?: "", style = MaterialTheme.typography.titleLarge)
                        Text(m?.o("user")?.s("email") ?: api.user ?: "", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(4.dp))
                        Pill(roleLabel(m), C.Brand)
                    }
                }
                Spacer(Modifier.height(14.dp))
                val st = m?.o("stats")
                Row(Modifier.fillMaxWidth()) {
                    Stat("${st?.i("lessonsTaught") ?: 0}", "lessons\nrecorded", Modifier.weight(1f))
                    Stat("${st?.i("pagesScanned") ?: 0}", "pages\nscanned", Modifier.weight(1f))
                    Stat("${st?.i("schemesPublished") ?: 0}", "schemes\npublished", Modifier.weight(1f))
                }
            }
        }
        item {
            Notice(Icons.Filled.TaskAlt, "Keep going! Every lesson you mark as taught keeps the school's coverage right.", C.Warn, C.WarnSoft)
        }
        m?.let { item { WeekCard(it) } }
        item { SectionHeader(if (m?.optBoolean("allClasses") == true) "Classes" else "My classes") }
        item {
            Card {
                val classes = m?.a("classes").objs(); val subjects = m?.a("subjects").objs()
                Text(classes.joinToString(" · ") { it.s("name") ?: "" }.ifEmpty { "—" })
                Spacer(Modifier.height(6.dp))
                Text("Subjects: " + subjects.joinToString(" · ") { it.s("name") ?: "" }.ifEmpty { "—" }, style = MaterialTheme.typography.bodySmall)
            }
        }
        item {
            Card(padding = 6.dp) {
                MenuRow("My timetable", Icons.Filled.CalendarMonth, C.Brand, C.BrandSoft) { nav.navigate("timetable") }
                MenuRow("Image library", Icons.Filled.Image, C.Teal, C.TealSoft) { nav.navigate("figures") }
                MenuRow("Ask Ledgerly AI", Icons.Filled.AutoAwesome, C.Ai, C.AiSoft) { nav.navigate("ai") }
                MenuRow("Sign out", Icons.Filled.Logout, C.Bad, C.BadSoft) { confirm = true }
            }
        }
        item { Text("${m?.s("school") ?: api.school ?: ""} · ${api.baseUrl}\nLedgerly Academics ${com.ledgerly.scanner.BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall) }
    }
    if (confirm) androidx.compose.material3.AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Sign out?") },
        text = { Text("Scanned pages that are not sent yet stay on this phone and are sent after you sign in again.") },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { confirm = false; onSignOut() }) { Text("Sign out") } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { confirm = false }) { Text("Cancel") } },
    )
}

private fun roleLabel(m: JSONObject?): String {
    val can = m?.o("can") ?: return "Staff"
    return when {
        can.optBoolean("admin") -> "Administrator"
        can.optBoolean("manage") -> "Director of Studies"
        m.o("staff")?.optBoolean("isTeacher") == true -> "Teacher"
        else -> "Staff"
    }
}

/* ───────────── Search ───────────── */

@Composable
fun SearchScreen() {
    val nav = LocalNav.current
    var q by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(q) { delay(350); query = q.trim() }
    val res = rememberData(if (query.length >= 2) "/api/v1/learn/search?q=${enc(query)}" else null)
    Page("Search", onBack = { nav.popBackStack() }) {
        item { Field("Resources, lessons, learners or questions", q, { q = it }) }
        if (query.length < 2) { item { Empty("Search everything", "Type at least two letters: a topic (\"feathers\"), a resource title, learner's name, or words from a question.") }; return@Page }
        val d = res.obj
        status(res, d != null && d.a("resources").length() + d.a("lessons").length() + d.a("learners").length() + d.a("questions").length() == 0, "Nothing found", "Try another word.")
        if (d == null) return@Page
        d.a("resources").objs().takeIf { it.isNotEmpty() }?.let { list ->
            item { SectionHeader("E-library resources") }
            item { Card(padding = 8.dp) { list.forEach { r ->
                ListRow(r.s("title") ?: "Untitled resource", listOfNotNull(r.s("type"), r.s("class"), r.s("subject"), r.s("term")).joinToString(" · "),
                    trailing = { if (r.s("status") != "published") Pill("Draft", C.Warn, C.WarnSoft) },
                    leading = { IconTile(Icons.Filled.MenuBook, C.Brand, C.BrandSoft, 38.dp) }) { nav.navigate("resource/${r.s("slug")}") }
            } } }
        }
        d.a("lessons").objs().takeIf { it.isNotEmpty() }?.let { list ->
            item { SectionHeader("Lessons") }
            item { Card(padding = 8.dp) { list.forEach { l ->
                ListRow(l.s("title") ?: "", listOfNotNull(l.s("className"), l.s("subject"), l.s("week")?.let { "Week $it" }).joinToString(" · "),
                    leading = { val (bg, fg) = C.tile(l.s("subject")); IconTile(Icons.Filled.MenuBook, fg, bg, 38.dp) }) { nav.navigate("lesson/${l.s("id")}") } } } }
        }
        d.a("learners").objs().takeIf { it.isNotEmpty() }?.let { list ->
            item { SectionHeader("Learners") }
            item { Card(padding = 8.dp) { list.forEach { s ->
                ListRow(s.s("name") ?: "", listOfNotNull(s.s("className"), s.s("admissionNumber")).joinToString(" · "), leading = { Avatar(s.s("name") ?: "", 38.dp) }) { nav.navigate("learner/${s.s("id")}") } } } }
        }
        d.a("questions").objs().takeIf { it.isNotEmpty() }?.let { list ->
            item { SectionHeader("Questions") }
            item { Card(padding = 8.dp) { list.forEach { x ->
                ListRow(x.s("stem") ?: "", listOfNotNull(x.s("className"), x.s("subject"), x.s("topic")).joinToString(" · "),
                    leading = { IconTile(Icons.Filled.Quiz, C.Warn, C.WarnSoft, 38.dp) }) { nav.navigate("question/${x.s("id")}") } } } }
        }
    }
}

/** Trusted in-app reader. Draft resources stay private while signed-in staff can search and read them. */
@Composable
fun ResourceScreen(slug: String) {
    val nav = LocalNav.current
    val res = rememberData("/api/v1/learn/library/${enc(slug)}")
    val r = res.obj
    Page(r?.s("title") ?: "E-library resource", onBack = { nav.popBackStack() },
        subtitle = r?.let { listOfNotNull(it.s("type"), it.s("class"), it.s("subject")).joinToString(" · ") }) {
        if (r == null) { status(res, false, "", ""); return@Page }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(if (r.s("status") == "published") "Published" else "Draft", if (r.s("status") == "published") C.Ok else C.Warn)
            r.s("term")?.let { Pill(it, C.Brand) }
        } }
        r.s("description")?.let { item { Card { Text(it) } } }
        val content = r.s("text").orEmpty().trim()
        if (content.isEmpty()) item { Empty("Text is being prepared", "The file is searchable by its details, but its readable text is not ready yet.") }
        else {
            item { SectionHeader("Document text") }
            content.chunked(3500).forEach { chunk -> item { Card { Text(chunk, style = MaterialTheme.typography.bodyLarge) } } }
            if (r.optBoolean("truncated")) item { Notice(Icons.Filled.MenuBook, "Showing the first part of this document.", C.Warn, C.WarnSoft) }
        }
    }
}

/** Runs a call off the main thread and reports failure as a short message. */
fun launchCall(scope: kotlinx.coroutines.CoroutineScope, ctx: android.content.Context, onDone: (Boolean) -> Unit = {}, block: suspend () -> Unit) {
    scope.launch {
        val ok = try { withContext(Dispatchers.IO) { block() }; true } catch (e: Exception) { Toast.makeText(ctx, friendly(e), Toast.LENGTH_LONG).show(); false }
        onDone(ok)
    }
}

@Suppress("unused") private val unusedPersonIcon = Icons.Filled.Person
