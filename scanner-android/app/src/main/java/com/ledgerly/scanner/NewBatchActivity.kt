package com.ledgerly.scanner

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.MaterialAutoCompleteTextView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import kotlin.concurrent.thread

/** Starts a batch: what is being scanned, for which class and subject, and on which day the work was done. */
class NewBatchActivity : AppCompatActivity() {
    private var classes: List<Pair<String, String>> = emptyList()
    private var subjects: List<Pair<String, String>> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.column(this)
        col.addView(Ui.title(this, "New scan batch"))
        col.addView(Ui.text(this, "What are you scanning?", 14f, Ui.MUTED))
        val kinds = RadioGroup(this)
        Ui.KINDS.entries.forEachIndexed { i, (key, label) ->
            kinds.addView(RadioButton(this).apply { id = 1000 + i; text = label; tag = key; textSize = 16f; isChecked = i == 0 })
        }
        col.addView(kinds)

        fun dropdown(hint: String): MaterialAutoCompleteTextView {
            val layout = TextInputLayout(this, null, com.google.android.material.R.attr.textInputOutlinedExposedDropdownMenuStyle).apply { this.hint = hint }
            val view = MaterialAutoCompleteTextView(layout.context).apply { inputType = 0 }
            layout.addView(view); col.addView(layout); col.addView(Ui.gap(this, 6)); return view
        }
        val classBox = dropdown("Class")
        val subjectBox = dropdown("Subject (optional)")
        var day = LocalDate.now()
        val dayButton = Ui.button(this, "Date of the work: $day", primary = false) {}
        dayButton.setOnClickListener {
            DatePickerDialog(this, { _, y, m, d -> day = LocalDate.of(y, m + 1, d); dayButton.text = "Date of the work: $day" }, day.year, day.monthValue - 1, day.dayOfMonth).show()
        }
        col.addView(dayButton)
        val titleLayout = TextInputLayout(this).apply { hint = "Title (optional), e.g. Exercise 3: fractions" }
        val title = TextInputEditText(titleLayout.context); titleLayout.addView(title); col.addView(titleLayout)

        col.addView(Ui.button(this, "Start scanning") {
            val ci = classes.indexOfFirst { it.second == classBox.text.toString() }
            if (ci < 0) { Toast.makeText(this, "Choose the class", Toast.LENGTH_SHORT).show(); return@button }
            val si = subjects.indexOfFirst { it.second == subjectBox.text.toString() }
            val kind = kinds.findViewById<RadioButton>(kinds.checkedRadioButtonId).tag as String
            val batch = Batch(Store.newId(), null, kind, classes[ci].first, classes[ci].second,
                subjects.getOrNull(si)?.first, subjects.getOrNull(si)?.second, day.toString(), title.text?.toString()?.trim()?.ifEmpty { null })
            Store.update(this) { it.add(batch) }
            UploadWorker.kick(this)
            startActivity(Intent(this, BatchActivity::class.java).putExtra("batch", batch.localId))
            finish()
        })
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })

        fun fill(ctx: JSONObject) {
            classes = pairs(ctx.getJSONArray("classes")); subjects = pairs(ctx.getJSONArray("subjects"))
            classBox.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, classes.map { it.second }))
            subjectBox.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf("—") + subjects.map { it.second }))
        }
        cachedContext(this)?.let { fill(it) }
        thread {
            try {
                val ctx = Api(this).get("/api/v1/learn/captures/context")
                getSharedPreferences("ledgerly", Context.MODE_PRIVATE).edit().putString("context", ctx.toString()).apply()
                runOnUiThread { fill(ctx) }
            } catch (e: Exception) {
                runOnUiThread { if (classes.isEmpty()) Toast.makeText(this, "Offline: connect once to load the class list", Toast.LENGTH_LONG).show() }
            }
        }
    }

    companion object {
        fun pairs(arr: JSONArray) = List(arr.length()) { i -> arr.getJSONObject(i).let { it.getString("id") to it.getString("name") } }
        fun cachedContext(ctx: Context) = ctx.getSharedPreferences("ledgerly", Context.MODE_PRIVATE).getString("context", null)?.let { JSONObject(it) }
    }
}
