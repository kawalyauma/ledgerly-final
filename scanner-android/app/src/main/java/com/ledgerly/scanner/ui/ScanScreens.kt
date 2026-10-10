package com.ledgerly.scanner.ui

import android.app.Activity
import android.app.DatePickerDialog
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.ledgerly.scanner.Batch
import com.ledgerly.scanner.Page as ScanPage
import com.ledgerly.scanner.Store
import com.ledgerly.scanner.UploadWorker
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

val KINDS = linkedMapOf(
    "student_books" to "Learners' exercise books",
    "exam_scripts" to "Exam / test scripts",
    "lesson_plan_book" to "Teacher's lesson plan book",
    "teacher_notes" to "Teacher's notes book",
)

/** Re-reads the phone's batches every few seconds so upload progress shows live. */
@Composable
private fun rememberBatches(): List<Batch> {
    val ctx = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(3000); tick++ } }
    return remember(tick) { Store.all(ctx).sortedByDescending { it.createdAt } }
}

@Composable
fun ScanScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val batches = rememberBatches()
    val review = LocalMe.current.obj?.o("stats")?.i("pagesToReview") ?: 0
    LaunchedEffect(Unit) { UploadWorker.kick(ctx) }
    Page("Scan books", subtitle = "Ledgerly AI reads every page", actions = { IconButton(onClick = { nav.navigate("newbatch") }) { Icon(Icons.Filled.Add, "New batch", tint = C.Brand) } }) {
        item {
            FeaturedCard("Scanner", "Scan a pile of books", "Exercise books, test scripts or lesson plan books. Pages are sent when there is a connection.", "New scan batch") { nav.navigate("newbatch") }
        }
        if (review > 0) item { Notice(Icons.Filled.RateReview, "$review scanned page(s) need a learner's name. Open the batch on Ledgerly to pick the learner.", C.Warn, C.WarnSoft) }
        item { SectionHeader("On this phone") }
        if (batches.isEmpty()) item { Empty("No batches yet", "Tap \"New scan batch\" to start.") }
        batches.take(80).forEach { b -> item { BatchCard(b) { nav.navigate("batch/${b.localId}") } } }
    }
}

@Composable
private fun BatchCard(b: Batch, onClick: () -> Unit) {
    val sent = b.pages.count { it.status == "uploaded" }
    val failed = b.pages.count { it.status == "failed" }
    Card(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Filled.DocumentScanner, C.Teal, C.TealSoft, 44.dp); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(b.title ?: KINDS[b.kind] ?: b.kind, style = MaterialTheme.typography.titleSmall)
                Text(listOfNotNull(b.className, b.subjectName, b.capturedOn).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            }
            when (b.status) {
                "sent" -> Pill("Sent", C.Ok)
                "sending" -> Pill("Sending $sent/${b.pages.size}", C.Brand)
                else -> Pill("Scanning", C.Warn)
            }
        }
        if (b.pages.isNotEmpty()) { Spacer(Modifier.height(10.dp)); Bar(sent.toFloat() / b.pages.size, if (failed > 0) C.Bad else C.Teal) }
        Spacer(Modifier.height(4.dp))
        Text("${b.pages.size} page(s) · $sent sent" + (if (failed > 0) " · $failed failed" else "") + (b.error?.takeIf { b.status != "sent" }?.let { " · waiting for connection" } ?: ""),
            style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun NewBatchScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val c = rememberData("/api/v1/learn/captures/context").obj
    var kind by remember { mutableStateOf("student_books") }
    var cls by remember { mutableStateOf<JSONObject?>(null) }
    var sub by remember { mutableStateOf<JSONObject?>(null) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var title by remember { mutableStateOf("") }
    Page("New scan batch", onBack = { nav.popBackStack() }) {
        item { SectionHeader("What are you scanning?") }
        item {
            Card(padding = 6.dp) {
                KINDS.forEach { (k, label) ->
                    Row(Modifier.fillMaxWidth().clickable { kind = k }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(kind == k, { kind = k }); Text(label)
                    }
                }
            }
        }
        item { Picker("Class", c?.a("classes").objs(), cls) { cls = it } }
        item { Picker("Subject (optional)", c?.a("subjects").objs(), sub) { sub = it } }
        item {
            SecondaryButton("Date of the work: $day") {
                DatePickerDialog(ctx, { _, y, m, d -> day = LocalDate.of(y, m + 1, d) }, day.year, day.monthValue - 1, day.dayOfMonth).show()
            }
        }
        item { Field("Title (optional), e.g. Exercise 3: fractions", title, { title = it }) }
        if (c == null) item { Text("Connect once to load the class list.", style = MaterialTheme.typography.bodySmall) }
        item {
            PrimaryButton("Start scanning", enabled = cls != null) {
                val b = Batch(Store.newId(), null, kind, cls!!.s("id"), cls!!.s("name"), sub?.s("id"), sub?.s("name"), day.toString(), title.trim().ifEmpty { null })
                Store.update(ctx) { it.add(b) }
                UploadWorker.kick(ctx)
                nav.navigate("batch/${b.localId}") { popUpTo("newbatch") { inclusive = true } }
            }
        }
    }
}

@Composable
fun BatchScreen(localId: String) {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    val batches = rememberBatches()
    val b = batches.firstOrNull { it.localId == localId }
    var learner by remember { mutableStateOf<JSONObject?>(null) }
    var serverInfo by remember { mutableStateOf<String?>(null) }
    val students = rememberData(b?.classId?.takeIf { b.kind == "student_books" || b.kind == "exam_scripts" }?.let { "/api/v1/learn/captures/context?classId=$it" })
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data) ?: return@rememberLauncherForActivityResult
        val pages = scan.pages ?: return@rememberLauncherForActivityResult
        val dir = Store.pagesDir(ctx)
        Store.update(ctx) { list ->
            val bb = list.first { it.localId == localId }
            var seq = bb.pages.maxOfOrNull { it.seq } ?: 0
            for (p in pages) {
                val id = Store.newId()
                val target = File(dir, "$id.jpg")
                ctx.contentResolver.openInputStream(p.imageUri)?.use { input -> target.outputStream().use { input.copyTo(it) } } ?: continue
                seq += 1
                bb.pages.add(ScanPage(id, seq, target.absolutePath, learner?.s("id"), learner?.s("name")))
            }
            if (bb.status == "sent") bb.status = "sending"
        }
        UploadWorker.kick(ctx)
        Toast.makeText(ctx, "${pages.size} page(s) added", Toast.LENGTH_SHORT).show()
    }
    if (b == null) { Page("Batch", onBack = { nav.popBackStack() }) { item { Empty("Batch not found", "It may have been removed from this phone.") } }; return }
    Page(b.title ?: KINDS[b.kind] ?: "Scan batch", onBack = { nav.popBackStack() }, subtitle = listOfNotNull(b.className, b.subjectName, b.capturedOn).joinToString(" · "),
        bottom = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("Scan pages") {
                    val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(100)
                        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
                    GmsDocumentScanning.getClient(options).getStartScanIntent(ctx as Activity)
                        .addOnSuccessListener { sender -> scanner.launch(IntentSenderRequest.Builder(sender).build()) }
                        .addOnFailureListener { e -> Toast.makeText(ctx, "The document scanner needs Google Play services. ${e.message ?: ""}", Toast.LENGTH_LONG).show() }
                }
                if (b.status == "scanning" && b.pages.isNotEmpty()) SecondaryButton("Finish and send") {
                    Store.update(ctx) { list -> list.first { it.localId == localId }.status = "sending" }
                    UploadWorker.kick(ctx)
                    Toast.makeText(ctx, "Sending in the background. You can keep scanning other batches.", Toast.LENGTH_LONG).show()
                    nav.popBackStack()
                }
            }
        }) {
        if (b.kind == "student_books" || b.kind == "exam_scripts") {
            item {
                val auto = JSONObject().put("id", "").put("name", "Automatic: read the name on the page")
                Picker("Whose book are the next pages?", listOf(auto) + students.obj?.a("students").objs().orEmpty(), learner ?: auto) { learner = it.takeIf { o -> o.s("id") != null } }
            }
            item { Text("Leave on automatic and Ledgerly AI reads the learner's name on each page.", style = MaterialTheme.typography.bodySmall) }
        }
        val sent = b.pages.count { it.status == "uploaded" }
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Ring(if (b.pages.isEmpty()) 0f else sent.toFloat() / b.pages.size, "$sent/${b.pages.size}", C.Teal, 56.dp); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${b.pages.size} page(s) scanned", style = MaterialTheme.typography.titleSmall)
                        Text("$sent sent" + (b.pages.count { it.status == "failed" }.takeIf { it > 0 }?.let { " · $it failed" } ?: ""), style = MaterialTheme.typography.bodySmall)
                        Text("Check reading progress", color = C.Brand, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp).clickable {
                            val sid = b.serverId
                            if (sid == null) serverInfo = "Not on the server yet. It is sent as soon as there is a connection."
                            else launchCall(scope, ctx) {
                                val d = api.get("/api/v1/learn/captures/batches/$sid")
                                val counts = d.optJSONObject("counts") ?: JSONObject()
                                serverInfo = "On the server: ${d.optInt("pageCount")} pages · " + counts.keys().asSequence().map { k -> "${counts.getInt(k)} ${k.replace('_', ' ')}" }.joinToString(" · ")
                            }
                        })
                    }
                }
                serverInfo?.let { Spacer(Modifier.height(6.dp)); Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
        if (b.pages.isEmpty()) item { Empty("No pages yet", "Tap \"Scan pages\". The camera finds the page edges, crops and straightens each page.") }
        b.pages.sortedBy { it.seq }.chunked(3).forEach { row ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { p -> PageThumb(p, Modifier.weight(1f)) }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun PageThumb(p: ScanPage, modifier: Modifier) {
    val ctx = LocalContext.current
    val bmp = remember(p.path) {
        val f = File(p.path)
        if (f.exists()) BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = 8 })?.asImageBitmap() else null
    }
    Column(modifier.clickable { p.error?.let { Toast.makeText(ctx, it, Toast.LENGTH_LONG).show() } }) {
        Box(Modifier.fillMaxWidth().aspectRatio(.74f).clip(RoundedCornerShape(10.dp)).background(C.TealSoft), contentAlignment = Alignment.Center) {
            if (bmp != null) Image(bmp, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(.74f))
            else Icon(Icons.Filled.CameraAlt, null, tint = C.Teal)
        }
        Text("${p.seq} · " + when (p.status) { "uploaded" -> "✓ sent"; "failed" -> "✗ failed"; else -> "waiting" }, fontSize = 11.sp,
            color = if (p.status == "failed") C.Bad else C.Muted)
        p.studentName?.let { Text(it, fontSize = 11.sp, maxLines = 1) }
    }
}

@Suppress("unused") private val keepColor = Color.Unspecified
