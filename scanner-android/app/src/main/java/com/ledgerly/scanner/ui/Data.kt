package com.ledgerly.scanner.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import com.ledgerly.scanner.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest

val LocalApi = staticCompositionLocalOf<Api> { error("Api not provided") }

/** Last good answer for each address, so screens open instantly and still work without a connection. */
object Cache {
    private fun file(ctx: Context, path: String): File {
        val name = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(File(ctx.cacheDir, "json").apply { mkdirs() }, "$name.json")
    }
    fun get(ctx: Context, path: String): Any? = runCatching { JSONTokener(file(ctx, path).readText()).nextValue() }.getOrNull()
    fun put(ctx: Context, path: String, value: Any) { runCatching { file(ctx, path).writeText(value.toString()) } }
    fun clear(ctx: Context) { File(ctx.cacheDir, "json").deleteRecursively() }
}

class Loaded(val data: Any?, val loading: Boolean, val error: String?, val offline: Boolean, val reload: () -> Unit) {
    val obj get() = data as? JSONObject
    val arr get() = data as? JSONArray
}

/** Loads `data` from a Ledgerly address: the cached copy first, then the fresh one. */
@Composable
fun rememberData(path: String?): Loaded {
    val ctx = LocalContext.current
    val api = LocalApi.current
    var tick by remember { mutableIntStateOf(0) }
    var data by remember(path) { mutableStateOf(path?.let { Cache.get(ctx, it) }) }
    var loading by remember(path) { mutableStateOf(path != null) }
    var error by remember(path) { mutableStateOf<String?>(null) }
    var offline by remember(path) { mutableStateOf(false) }
    LaunchedEffect(path, tick) {
        if (path == null) return@LaunchedEffect
        loading = true
        try {
            val fresh = withContext(Dispatchers.IO) { api.data(path) }
            Cache.put(ctx, path, fresh); data = fresh; error = null; offline = false
        } catch (e: Exception) {
            error = friendly(e); offline = data != null
        }
        loading = false
    }
    return Loaded(data, loading, error, offline) { tick++ }
}

fun friendly(e: Throwable): String = when (e) {
    is java.net.UnknownHostException, is java.net.ConnectException -> "No connection. Showing what was saved on this phone."
    is java.net.SocketTimeoutException -> "Ledgerly took too long to answer. Try again."
    else -> e.message ?: "Something went wrong"
}

fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

// Small JSON helpers so screens stay readable.
fun JSONObject.s(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).ifBlank { null }
fun JSONObject.i(key: String, def: Int = 0): Int = if (!has(key) || isNull(key)) def else optInt(key, def)
fun JSONObject.o(key: String): JSONObject? = if (!has(key) || isNull(key)) null else optJSONObject(key)
fun JSONObject.a(key: String): JSONArray = optJSONArray(key) ?: JSONArray()
fun JSONArray?.objs(): List<JSONObject> = if (this == null) emptyList() else List(length()) { optJSONObject(it) ?: JSONObject() }
fun JSONArray?.strs(): List<String> = if (this == null) emptyList() else List(length()) { optString(it) }.filter { it.isNotBlank() }
