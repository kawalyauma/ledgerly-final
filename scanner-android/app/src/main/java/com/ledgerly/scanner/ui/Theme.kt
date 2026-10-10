package com.ledgerly.scanner.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Ledgerly Academics look: white cards on soft blue, one bold blue featured card, round icon chips. */
object C {
    val Brand = Color(0xFF1D5FD1)
    val BrandDark = Color(0xFF123D8A)
    val BrandSoft = Color(0xFFE8F0FD)
    val Ai = Color(0xFF7A3FD1)
    val AiSoft = Color(0xFFF1EAFD)
    val Ok = Color(0xFF127A4A)
    val OkSoft = Color(0xFFE5F5EC)
    val Warn = Color(0xFF9A5B00)
    val WarnSoft = Color(0xFFFDF3E1)
    val Bad = Color(0xFFB3261E)
    val BadSoft = Color(0xFFFCE8E6)
    val Teal = Color(0xFF0B7285)
    val TealSoft = Color(0xFFE3F6F8)
    val Ink = Color(0xFF16202C)
    val Muted = Color(0xFF5B6878)
    val Line = Color(0xFFDFE5EC)
    val Bg = Color(0xFFF5F8FD)
    val Card = Color.White
    val Featured = Brush.linearGradient(listOf(Color(0xFF1D5FD1), Color(0xFF3B7CF0), Color(0xFF7A3FD1)))
    /** Soft tile colours for subjects, picked by name so a subject keeps its colour everywhere. */
    private val tiles = listOf(BrandSoft to Brand, OkSoft to Ok, AiSoft to Ai, WarnSoft to Warn, TealSoft to Teal, Color(0xFFFDEBF1) to Color(0xFFB4235A))
    fun tile(name: String?) = tiles[((name ?: "").lowercase().hashCode() and 0x7fffffff) % tiles.size]
}

@Composable
fun AcademicsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = C.Brand, onPrimary = Color.White, primaryContainer = C.BrandSoft, onPrimaryContainer = C.BrandDark,
            secondary = C.Ai, secondaryContainer = C.AiSoft, background = C.Bg, surface = Color.White, onSurface = C.Ink,
            onBackground = C.Ink, surfaceVariant = Color(0xFFF0F3F8), onSurfaceVariant = C.Muted, outline = C.Line, error = C.Bad,
        ),
        typography = Typography(
            headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, color = C.Ink),
            titleLarge = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.Bold, color = C.Ink),
            titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = C.Ink),
            titleSmall = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink),
            bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = C.Ink),
            bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, color = C.Ink),
            bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, color = C.Muted),
            labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
            labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
        ),
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(22.dp)),
        content = content,
    )
}
