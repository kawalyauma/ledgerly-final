package com.ledgerly.scanner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.ledgerly.scanner.ui.AcademicsApp

/** Ledgerly Academics: one activity, every screen in Compose. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(0xFFF5F8FD.toInt(), 0xFFF5F8FD.toInt()))
        UploadWorker.kick(this)
        setContent { AcademicsApp() }
    }
}
