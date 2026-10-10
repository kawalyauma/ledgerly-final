package com.ledgerly.scanner

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : IOException(message)

/** Ledgerly API client: login, token refresh, and the learning-engine scanner endpoints. */
class Api(private val context: Context) {
    private val prefs = context.getSharedPreferences("ledgerly", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    var baseUrl: String
        get() = prefs.getString("baseUrl", "https://erp.notesug.com")!!
        set(v) = prefs.edit().putString("baseUrl", v.trimEnd('/')).apply()
    val signedIn get() = prefs.getString("refresh", null) != null
    val school get() = prefs.getString("school", null)
    val user get() = prefs.getString("user", null)

    fun login(identifier: String, password: String) {
        val body = JSONObject().put("identifier", identifier).put("password", password)
        val res = send(Request.Builder().url("$baseUrl/auth/login").post(body.toString().toRequestBody(json)).build(), auth = false)
        saveTokens(res.getJSONObject("data"))
        prefs.edit().putString("user", identifier).apply()
        val ctx = get("/api/v1/learn/captures/context")
        prefs.edit().putString("school", ctx.optString("school", "")).apply()
    }

    fun logout() = prefs.edit().remove("access").remove("refresh").remove("school").remove("user").apply()

    private fun saveTokens(d: JSONObject) {
        prefs.edit().putString("access", d.optString("accessToken")).putString("refresh", d.optString("refreshToken")).apply()
    }

    private fun refresh(): Boolean {
        val token = prefs.getString("refresh", null) ?: return false
        return try {
            val res = send(Request.Builder().url("$baseUrl/auth/refresh")
                .post(JSONObject().put("refreshToken", token).toString().toRequestBody(json)).build(), auth = false)
            saveTokens(res.getJSONObject("data")); true
        } catch (e: ApiException) {
            if (e.status == 401) logout(); false
        }
    }

    private fun send(request: Request, auth: Boolean = true, retried: Boolean = false): JSONObject {
        val req = if (auth) request.newBuilder().header("Authorization", "Bearer ${prefs.getString("access", "")}").build() else request
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (res.code == 401 && auth && !retried && refresh()) return send(request, auth, true)
            if (!res.isSuccessful) {
                val msg = runCatching { JSONObject(text).getJSONObject("error").getString("message") }.getOrDefault("Server error ${res.code}")
                throw ApiException(res.code, msg)
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    fun get(path: String): JSONObject = send(Request.Builder().url("$baseUrl$path").get().build()).getJSONObject("data")
    fun post(path: String, body: JSONObject): JSONObject = send(Request.Builder().url("$baseUrl$path").post(body.toString().toRequestBody(json)).build()).getJSONObject("data")

    fun uploadPage(batchId: String, clientPageId: String, seq: Int, studentId: String?, file: File): JSONObject {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("clientPageId", clientPageId)
            .addFormDataPart("seq", seq.toString())
            .addFormDataPart("analyze", "1")
            .apply { if (studentId != null) addFormDataPart("studentId", studentId) }
            .addFormDataPart("file", file.name, file.asRequestBody("image/jpeg".toMediaType()) as RequestBody)
            .build()
        return send(Request.Builder().url("$baseUrl/api/v1/learn/captures/batches/$batchId/pages").post(form).build()).getJSONObject("data")
    }
}
