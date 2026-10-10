package com.ledgerly.scanner

import android.content.Context
import android.graphics.BitmapFactory
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.MaterialAutoCompleteTextView
import com.google.android.material.textfield.TextInputLayout
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * One batch: scan pages in bursts (ML Kit finds the page edges, crops, straightens and cleans each photo),
 * optionally tag whose book it is, then finish so the pages are sent and read by Ledgerly AI.
 */
class BatchActivity : AppCompatActivity() {
    private lateinit var batchId: String
    private lateinit var grid: GridLayout
    private lateinit var summary: android.widget.TextView
    private lateinit var serverInfo: android.widget.TextView
    private var students: List<Pair<String, String>> = emptyList()
    private var learner: Pair<String, String>? = null

    private val scanner = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data) ?: return@registerForActivityResult
        val pages = scan.pages ?: return@registerForActivityResult
        val dir = Store.pagesDir(this)
        Store.update(this) { list ->
            val b = list.first { it.localId == batchId }
            var seq = (b.pages.maxOfOrNull { it.seq } ?: 0)
            for (p in pages) {
                val id = Store.newId()
                val target = File(dir, "$id.jpg")
                contentResolver.openInputStream(p.imageUri)?.use { input -> target.outputStream().use { input.copyTo(it) } } ?: continue
                seq += 1
                b.pages.add(Page(id, seq, target.absolutePath, learner?.first, learner?.second))
            }
            if (b.status == "sent") b.status = "sending"
        }
        UploadWorker.kick(this)
        render()
        Toast.makeText(this, "${pages.size} page(s) added", Toast.LENGTH_SHORT).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        batchId = intent.getStringExtra("batch") ?: run { finish(); return }
        val b = Store.get(this, batchId) ?: run { finish(); return }
        val col = Ui.column(this)
        col.addView(Ui.title(this, b.title ?: Ui.KINDS[b.kind] ?: "Scan batch"))
        col.addView(Ui.text(this, listOfNotNull(Ui.KINDS[b.kind], b.className, b.subjectName, b.capturedOn).joinToString(" · "), 14f, Ui.MUTED))

        if (b.kind == "student_books" || b.kind == "exam_scripts") {
            col.addView(Ui.gap(this, 10))
            val layout = TextInputLayout(this, null, com.google.android.material.R.attr.textInputOutlinedExposedDropdownMenuStyle).apply { hint = "Whose book are the next pages?" }
            val box = MaterialAutoCompleteTextView(layout.context).apply { inputType = 0; setText(AUTO, false) }
            layout.addView(box); col.addView(layout)
            col.addView(Ui.text(this, "Leave on automatic and Ledgerly AI reads the learner's name on the page.", 12f, Ui.MUTED))
            fun fill(json: JSONObject) {
                students = NewBatchActivity.pairs(json.getJSONArray("students"))
                box.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf(AUTO) + students.map { it.second }))
            }
            val prefs = getSharedPreferences("ledgerly", Context.MODE_PRIVATE)
            prefs.getString("students_${b.classId}", null)?.let { fill(JSONObject(it)) }
            box.setOnItemClickListener { _, _, pos, _ -> learner = if (pos == 0) null else students[pos - 1] }
            thread {
                runCatching { Api(this).get("/api/v1/learn/captures/context?classId=${b.classId}") }.onSuccess { json ->
                    prefs.edit().putString("students_${b.classId}", json.toString()).apply()
                    runOnUiThread { fill(json) }
                }
            }
        }

        col.addView(Ui.button(this, "Scan pages") { startScan() })
        summary = Ui.text(this, "", 14f, Ui.INK, true).apply { setPadding(0, Ui.dp(this@BatchActivity, 14), 0, 0) }
        col.addView(summary)
        grid = GridLayout(this).apply { columnCount = 4 }
        col.addView(grid)
        serverInfo = Ui.text(this, "", 13f, Ui.MUTED)
        col.addView(serverInfo)
        col.addView(Ui.button(this, "Finish and send") {
            Store.update(this) { list -> list.first { it.localId == batchId }.status = "sending" }
            UploadWorker.kick(this)
            Toast.makeText(this, "Sending in the background. You can keep scanning other batches.", Toast.LENGTH_LONG).show()
            finish()
        })
        col.addView(Ui.button(this, "Check reading progress", primary = false) { checkServer() })
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })
        render()
    }

    private fun startScan() {
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(100)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(this)
            .addOnSuccessListener { sender -> scanner.launch(IntentSenderRequest.Builder(sender).build()) }
            .addOnFailureListener { e ->
                AlertDialog.Builder(this).setTitle("Scanner unavailable")
                    .setMessage("The document scanner needs Google Play services. ${e.message ?: ""}").setPositiveButton("OK", null).show()
            }
    }

    private fun render() {
        val b = Store.get(this, batchId) ?: return
        val sent = b.pages.count { it.status == "uploaded" }
        summary.text = "${b.pages.size} page(s) · $sent sent" + (b.pages.count { it.status == "failed" }.takeIf { it > 0 }?.let { " · $it failed" } ?: "")
        grid.removeAllViews()
        val size = (resources.displayMetrics.widthPixels - Ui.dp(this, 48)) / 4
        for (p in b.pages.sortedBy { it.seq }) {
            val cell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(4, 8, 4, 8) }
            val img = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(size, (size * 1.35).toInt()); scaleType = ImageView.ScaleType.CENTER_CROP
                val f = File(p.path)
                if (f.exists()) setImageBitmap(BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = 8 }))
                else setBackgroundColor(0xFFE3F6F8.toInt())
            }
            cell.addView(img)
            val mark = when (p.status) { "uploaded" -> "✓ sent"; "failed" -> "✗ failed"; else -> "waiting" }
            cell.addView(Ui.text(this, "${p.seq} · $mark", 11f, if (p.status == "failed") 0xFFB3261E.toInt() else Ui.MUTED))
            p.studentName?.let { cell.addView(Ui.text(this, it, 11f, Ui.INK)) }
            cell.setOnClickListener { p.error?.let { msg -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show() } }
            grid.addView(cell)
        }
    }

    private fun checkServer() {
        val serverId = Store.get(this, batchId)?.serverId ?: run { serverInfo.text = "Not on the server yet. It is sent as soon as there is a connection."; return }
        thread {
            val text = runCatching {
                val d = Api(this).get("/api/v1/learn/captures/batches/$serverId")
                val c = d.getJSONObject("counts")
                val parts = c.keys().asSequence().map { k -> "${c.getInt(k)} ${k.replace('_', ' ')}" }.toList()
                "On the server: ${d.optInt("pageCount")} pages · " + parts.joinToString(" · ")
            }.getOrElse { "Could not reach Ledgerly: ${it.message}" }
            runOnUiThread { serverInfo.text = text }
        }
    }

    override fun onResume() { super.onResume(); if (::grid.isInitialized) render() }

    companion object { const val AUTO = "Automatic: read the name on the page" }
}
