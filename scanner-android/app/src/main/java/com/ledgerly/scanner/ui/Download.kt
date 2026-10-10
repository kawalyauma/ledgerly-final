package com.ledgerly.scanner.ui

import android.content.Context
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Download, share or print a scheme: choose the parts (all combined, scheme of work, lesson plans, notes),
 * the range (whole term, one week, or one lesson) and the format (PDF or Word).
 */
@Composable
fun DownloadDialog(schemeId: String, title: String, weeks: Int, lessonId: String? = null, lessonLabel: String? = null, startWeek: Int? = null, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val api = LocalApi.current
    val scope = rememberCoroutineScope()
    var parts by remember { mutableStateOf(if (lessonId != null) "plans,notes" else "scheme,plans,notes") }
    var range by remember { mutableStateOf(if (lessonId != null) "lesson" else if (startWeek != null) "week" else "term") }
    var week by remember { mutableStateOf(startWeek ?: 1) }
    var pdf by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf<String?>(null) }

    fun fetch(then: suspend (File, String) -> Unit) {
        val q = buildString {
            append("/api/v1/learn/schemes/$schemeId/export?format=${if (pdf) "pdf" else "docx"}&parts=$parts")
            when (range) { "lesson" -> append("&lessonId=$lessonId"); "week" -> append("&week=$week") }
        }
        val what = when (parts) { "scheme" -> "scheme"; "plans" -> "lesson-plans"; "notes" -> "notes"; "plans,notes" -> "plan-and-notes"; else -> "full" }
        val where = when (range) { "lesson" -> (lessonLabel ?: "lesson"); "week" -> "week-$week"; else -> "term" }
        val name = "$title-$what-$where".replace(Regex("[^A-Za-z0-9]+"), "-").trim('-') + if (pdf) ".pdf" else ".docx"
        val mime = if (pdf) "application/pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        launchCall(scope, ctx, { busy = null }) {
            val bytes = api.bytes(q)
            val f = File(File(ctx.cacheDir, "share").apply { mkdirs() }, name)
            f.writeBytes(bytes)
            withContext(Dispatchers.Main) { then(f, mime) }
        }
    }

    AlertDialog(
        onDismissRequest = { if (busy == null) onClose() },
        title = { Text("Download") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("What", style = MaterialTheme.typography.titleSmall)
                ChoiceRow(listOfNotNull(
                    "scheme,plans,notes" to "All combined", ("scheme" to "Scheme of work").takeIf { lessonId == null },
                    "plans" to "Lesson plans", "notes" to "Lesson notes", ("plans,notes" to "Plans + notes"),
                ), parts) { parts = it }
                Text("Which lessons", style = MaterialTheme.typography.titleSmall)
                ChoiceRow(listOfNotNull("term" to "Whole term", "week" to "One week", lessonId?.let { "lesson" to (lessonLabel ?: "This lesson") }), range) { range = it }
                if (range == "week") ChoiceRow((1..weeks.coerceAtLeast(1)).map { "$it" to "Week $it" }, "$week") { week = it.toInt() }
                Text("Format", style = MaterialTheme.typography.titleSmall)
                ChoiceRow(listOf("pdf" to "PDF", "docx" to "Word"), if (pdf) "pdf" else "docx") { pdf = it == "pdf" }
                Spacer(Modifier.height(4.dp))
                busy?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    PrimaryButton("Share", Modifier.weight(1f), enabled = busy == null) { busy = "Preparing the file…"; fetch { f, mime -> shareFile(ctx, f, mime) } }
                    SecondaryButton("Open", Modifier.weight(1f), enabled = busy == null) { busy = "Preparing the file…"; fetch { f, mime -> openFile(ctx, f, mime) } }
                }
                if (pdf) SecondaryButton("Print", enabled = busy == null) { busy = "Preparing the PDF…"; fetch { f, _ -> printPdf(ctx, f) } }
            }
        },
        confirmButton = { TextButton(onClick = onClose, enabled = busy == null) { Text("Close") } },
    )
}

fun openFile(ctx: Context, f: File, mime: String) {
    val uri = androidx.core.content.FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
    val view = android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { ctx.startActivity(view) }.onFailure { shareFile(ctx, f, mime) }
}

/** Sends a PDF to Android's printing (any printer the phone knows, or "Save as PDF"). */
fun printPdf(ctx: Context, f: File) {
    val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
    pm.print(f.nameWithoutExtension, object : PrintDocumentAdapter() {
        override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
            if (cancel?.isCanceled == true) { cb.onLayoutCancelled(); return }
            cb.onLayoutFinished(PrintDocumentInfo.Builder(f.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
        }
        override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) {
            try {
                f.inputStream().use { input -> FileOutputStream(dest.fileDescriptor).use { input.copyTo(it) } }
                cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            } catch (e: Exception) { cb.onWriteFailed(e.message) }
        }
    }, null)
}
