package com.ledgerly.scanner

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class Page(
    val id: String, val seq: Int, val path: String, val studentId: String?, val studentName: String?,
    var status: String = "pending", var error: String? = null,
)

data class Batch(
    val localId: String, var serverId: String?, val kind: String, val classId: String?, val className: String?,
    val subjectId: String?, val subjectName: String?, val capturedOn: String, val title: String?,
    /** scanning → sending (operator finished) → sent (all uploaded and submitted). */
    var status: String = "scanning", val createdAt: Long = System.currentTimeMillis(), var error: String? = null,
    val pages: MutableList<Page> = mutableListOf(),
)

/** Batches and pages kept on the phone until they are safely on the server, so scanning works offline. */
object Store {
    private val lock = Any()
    private fun file(ctx: Context) = File(ctx.filesDir, "batches.json")
    fun pagesDir(ctx: Context) = File(ctx.filesDir, "pages").apply { mkdirs() }

    fun all(ctx: Context): MutableList<Batch> = synchronized(lock) {
        val f = file(ctx)
        if (!f.exists()) return mutableListOf()
        val arr = JSONArray(f.readText())
        MutableList(arr.length()) { i -> fromJson(arr.getJSONObject(i)) }
    }

    fun save(ctx: Context, batches: List<Batch>) = synchronized(lock) {
        val tmp = File(ctx.filesDir, "batches.json.tmp")
        tmp.writeText(JSONArray(batches.map { toJson(it) }).toString())
        tmp.renameTo(file(ctx))
    }

    fun <T> update(ctx: Context, block: (MutableList<Batch>) -> T): T = synchronized(lock) {
        val list = all(ctx); val r = block(list); save(ctx, list); r
    }

    fun get(ctx: Context, localId: String) = all(ctx).firstOrNull { it.localId == localId }

    fun newId(): String = UUID.randomUUID().toString()

    private fun toJson(b: Batch) = JSONObject().apply {
        put("localId", b.localId); put("serverId", b.serverId); put("kind", b.kind); put("classId", b.classId); put("className", b.className)
        put("subjectId", b.subjectId); put("subjectName", b.subjectName); put("capturedOn", b.capturedOn); put("title", b.title)
        put("status", b.status); put("createdAt", b.createdAt); put("error", b.error)
        put("pages", JSONArray(b.pages.map { p ->
            JSONObject().put("id", p.id).put("seq", p.seq).put("path", p.path).put("studentId", p.studentId).put("studentName", p.studentName)
                .put("status", p.status).put("error", p.error)
        }))
    }

    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k).ifEmpty { null }

    private fun fromJson(o: JSONObject): Batch {
        val pages = o.getJSONArray("pages")
        return Batch(o.getString("localId"), o.str("serverId"), o.getString("kind"), o.str("classId"), o.str("className"), o.str("subjectId"),
            o.str("subjectName"), o.getString("capturedOn"), o.str("title"), o.optString("status", "scanning"), o.optLong("createdAt"), o.str("error"),
            MutableList(pages.length()) { i ->
                val p = pages.getJSONObject(i)
                Page(p.getString("id"), p.getInt("seq"), p.getString("path"), p.str("studentId"), p.str("studentName"), p.optString("status", "pending"), p.str("error"))
            })
    }
}
