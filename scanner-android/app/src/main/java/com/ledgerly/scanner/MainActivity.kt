package com.ledgerly.scanner

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Home: the batches on this phone and how far each has been sent. */
class MainActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable { override fun run() { render(); handler.postDelayed(this, 3000) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val api = Api(this)
        val col = Ui.column(this)
        col.addView(Ui.title(this, "Ledgerly Scanner"))
        col.addView(Ui.text(this, listOfNotNull(api.school, api.user).joinToString(" · "), 14f, Ui.MUTED))
        col.addView(Ui.button(this, "New scan batch") { startActivity(Intent(this, NewBatchActivity::class.java)) })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(list)
        col.addView(Ui.gap(this, 24))
        col.addView(Ui.button(this, "Sign out", primary = false) {
            AlertDialog.Builder(this).setMessage("Sign out of this phone? Pages not yet sent stay on the phone and are sent after you sign in again.")
                .setPositiveButton("Sign out") { _, _ -> api.logout(); startActivity(Intent(this, LoginActivity::class.java)); finish() }
                .setNegativeButton("Cancel", null).show()
        })
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })
        UploadWorker.kick(this)
    }

    override fun onResume() { super.onResume(); handler.post(tick) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(tick) }

    private fun render() {
        list.removeAllViews()
        val batches = Store.all(this).sortedByDescending { it.createdAt }
        if (batches.isEmpty()) { list.addView(Ui.text(this, "\nNo batches yet. Tap \"New scan batch\" to start.", 15f, Ui.MUTED)); return }
        for (b in batches.take(60)) {
            val card = Ui.card(this)
            card.addView(Ui.text(this, b.title ?: Ui.KINDS[b.kind] ?: b.kind, 16f, Ui.INK, true))
            card.addView(Ui.text(this, listOfNotNull(b.className, b.subjectName, b.capturedOn).joinToString(" · "), 13f, Ui.MUTED))
            val sent = b.pages.count { it.status == "uploaded" }
            val failed = b.pages.count { it.status == "failed" }
            val (label, color) = when {
                b.status == "sent" -> "Sent · $sent pages" to 0xFF127A4A.toInt()
                b.status == "sending" -> "Sending $sent/${b.pages.size}" to Ui.BRAND
                else -> "Scanning · ${b.pages.size} pages ($sent sent)" to 0xFF9A5B00.toInt()
            }
            card.addView(Ui.gap(this, 4))
            card.addView(Ui.pill(this, label + if (failed > 0) " · $failed failed" else "", color))
            if (b.error != null && b.status != "sent") card.addView(Ui.text(this, "Waiting for connection: ${b.error}", 12f, Ui.MUTED))
            card.setOnClickListener { startActivity(Intent(this, BatchActivity::class.java).putExtra("batch", b.localId)) }
            list.addView(card)
        }
    }
}
