package com.ledgerly.scanner

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.ScrollView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlin.concurrent.thread

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val api = Api(this)
        if (api.signedIn) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        val col = Ui.column(this, 24)
        col.addView(Ui.gap(this, 32))
        col.addView(Ui.title(this, "Ledgerly Scanner"))
        col.addView(Ui.text(this, "Scan exercise books and lesson plan books. Ledgerly AI reads every page.", 15f, Ui.MUTED))
        col.addView(Ui.gap(this, 20))
        fun field(hint: String, value: String = "", type: Int = InputType.TYPE_CLASS_TEXT): TextInputEditText {
            val layout = TextInputLayout(this).apply { this.hint = hint }
            val edit = TextInputEditText(layout.context).apply { setText(value); inputType = type }
            layout.addView(edit); col.addView(layout); return edit
        }
        val server = field("Ledgerly address", api.baseUrl, InputType.TYPE_TEXT_VARIATION_URI)
        val user = field("Email, username or phone")
        val pass = field("Password", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        lateinit var go: com.google.android.material.button.MaterialButton
        go = Ui.button(this, "Sign in") {
            go.isEnabled = false; go.text = "Signing in…"
            thread {
                try {
                    api.baseUrl = server.text.toString().trim().ifEmpty { "https://erp.notesug.com" }
                    api.login(user.text.toString().trim(), pass.text.toString())
                    runOnUiThread { startActivity(Intent(this, MainActivity::class.java)); finish() }
                } catch (e: Exception) {
                    runOnUiThread { go.isEnabled = true; go.text = "Sign in"; Toast.makeText(this, e.message ?: "Could not sign in", Toast.LENGTH_LONG).show() }
                }
            }
        }
        col.addView(go)
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(col) })
    }
}
