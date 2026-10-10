package com.ledgerly.scanner

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.button.MaterialButton

/** Small helpers so screens can be built in code with one consistent look. */
object Ui {
    const val BRAND = 0xFF1D5FD1.toInt()
    const val INK = 0xFF16202C.toInt()
    const val MUTED = 0xFF5B6878.toInt()
    const val BG = 0xFFF6F8FB.toInt()

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    fun column(ctx: Context, padding: Int = 16) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, padding), dp(ctx, padding), dp(ctx, padding), dp(ctx, padding))
    }

    fun text(ctx: Context, value: String, size: Float = 15f, color: Int = INK, bold: Boolean = false) = TextView(ctx).apply {
        text = value; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    fun title(ctx: Context, value: String) = text(ctx, value, 22f, INK, true).apply { setPadding(0, 0, 0, dp(ctx, 4)) }

    fun button(ctx: Context, label: String, primary: Boolean = true, onClick: () -> Unit) =
        MaterialButton(ctx, null, if (primary) com.google.android.material.R.attr.materialButtonStyle else com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = label; isAllCaps = false; textSize = 16f
            minHeight = dp(ctx, 52)
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(ctx, 10) }
        }

    fun card(ctx: Context) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, 14), dp(ctx, 12), dp(ctx, 14), dp(ctx, 12))
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(ctx, 12).toFloat(); setStroke(dp(ctx, 1), 0xFFDFE5EC.toInt()) }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(ctx, 10) }
    }

    fun pill(ctx: Context, label: String, color: Int) = text(ctx, label, 12f, color, true).apply {
        setPadding(dp(ctx, 8), dp(ctx, 2), dp(ctx, 8), dp(ctx, 2)); gravity = Gravity.CENTER
        background = GradientDrawable().apply { setColor((color and 0x00FFFFFF) or 0x22000000); cornerRadius = dp(ctx, 20).toFloat() }
    }

    fun gap(ctx: Context, h: Int = 8) = View(ctx).apply { layoutParams = LinearLayout.LayoutParams(1, dp(ctx, h)) }

    val KINDS = linkedMapOf(
        "student_books" to "Learners' exercise books",
        "exam_scripts" to "Exam / test scripts",
        "lesson_plan_book" to "Teacher's lesson plan book",
        "teacher_notes" to "Teacher's notes book",
    )
}
