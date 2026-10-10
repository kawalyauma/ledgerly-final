package com.ledgerly.scanner

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Sends queued pages in the background whenever there is a connection. Each page carries its own id,
 * so a page that was sent but not confirmed is recognised by the server instead of being stored twice.
 */
class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val api = Api(applicationContext)
        if (!api.signedIn) return@withContext Result.success()
        var retry = false
        for (batch in Store.all(applicationContext)) {
            if (batch.status == "sent") continue
            try {
                val serverId = batch.serverId ?: createOnServer(api, batch)
                for (page in batch.pages.filter { it.status != "uploaded" }) {
                    val file = File(page.path)
                    if (!file.exists()) { mark(batch.localId, page.id, "failed", "Image missing on the phone"); continue }
                    try {
                        api.uploadPage(serverId, page.id, page.seq, page.studentId, file)
                        mark(batch.localId, page.id, "uploaded", null)
                    } catch (e: ApiException) {
                        // 4xx other than auth/rate limits will not fix themselves; keep the message for the operator.
                        if (e.status in 400..499 && e.status != 401 && e.status != 408 && e.status != 429) mark(batch.localId, page.id, "failed", e.message)
                        else { retry = true; break }
                    }
                }
                val fresh = Store.get(applicationContext, batch.localId) ?: continue
                if (fresh.status == "sending" && fresh.pages.none { it.status == "pending" }) {
                    api.post("/api/v1/learn/captures/batches/$serverId/submit", JSONObject())
                    Store.update(applicationContext) { list ->
                        list.firstOrNull { it.localId == batch.localId }?.let { b ->
                            b.status = "sent"; b.error = null
                            // The server has the images now; free the phone's storage.
                            b.pages.filter { it.status == "uploaded" }.forEach { File(it.path).delete() }
                        }
                    }
                }
            } catch (e: IOException) {
                Store.update(applicationContext) { list -> list.firstOrNull { it.localId == batch.localId }?.error = e.message }
                retry = true
            }
        }
        if (retry) Result.retry() else Result.success()
    }

    private fun createOnServer(api: Api, b: Batch): String {
        val body = JSONObject().put("kind", b.kind).put("capturedOn", b.capturedOn).put("deviceId", android.os.Build.MODEL)
        b.classId?.let { body.put("classId", it) }
        b.subjectId?.let { body.put("subjectId", it) }
        b.title?.let { body.put("title", it) }
        val id = api.post("/api/v1/learn/captures/batches", body).getString("id")
        Store.update(applicationContext) { list -> list.firstOrNull { it.localId == b.localId }?.serverId = id }
        return id
    }

    private fun mark(batchId: String, pageId: String, status: String, error: String?) = Store.update(applicationContext) { list ->
        list.firstOrNull { it.localId == batchId }?.pages?.firstOrNull { it.id == pageId }?.let { it.status = status; it.error = error }
    }

    companion object {
        fun kick(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("ledgerly-upload", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
