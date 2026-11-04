package app.haraguri.collect

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Sends notification payloads to the family's collection endpoint, in order, one at a time.
 * Payloads wait in a persisted queue so an offline moment loses nothing; the queue drains on the next
 * notification, on app open, and after a successful pairing.
 */
object Sender {
    private val exec = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile var onChange: (() -> Unit)? = null

    class Result(val status: Int, val body: String)

    fun enqueue(ctx: Context, payload: JSONObject) {
        val store = Store(ctx)
        val q = store.queue
        q.put(payload.put("queued_at", System.currentTimeMillis()))
        store.queue = q
        flush(ctx)
    }

    fun notifyChanged() { onChange?.let { cb -> main.post { cb() } } }

    fun flush(ctx: Context) {
        val app = ctx.applicationContext
        exec.execute { drain(app) }
    }

    private fun drain(ctx: Context) {
        val store = Store(ctx)
        val token = store.token ?: return
        var q = store.queue
        while (q.length() > 0) {
            val item = q.getJSONObject(0)
            val r = try { post(store.ingestUrl, token, item) } catch (_: IOException) { null }
            if (r == null) break // offline: keep the queue as it is
            q = without(q, 0)
            store.queue = q
            // ingest answers {saved: id} | {duplicate: true} | {ignored, inbox} | {error} — map all to one word for the log.
            val json = try { JSONObject(r.body) } catch (_: Exception) { JSONObject() }
            val inbox = json.optString("inbox", "").ifEmpty { if (json.has("saved")) "saved" else if (json.optBoolean("duplicate")) "duplicate" else "" }
            val status = if (r.status in 200..299 || inbox.isNotEmpty()) inbox.ifEmpty { "ok" } else "error ${r.status}"
            store.appendLog(JSONObject()
                .put("at", System.currentTimeMillis())
                .put("app", item.optString("app"))
                .put("title", item.optString("title").ifEmpty { item.optString("body").take(40) })
                .put("status", status))
            if (status == "saved" || status == "duplicate") store.sent = store.sent + 1
            store.lastSentAt = System.currentTimeMillis()
            if (r.status == 401 || r.status == 404) break // token rejected: stop hammering, the screen shows "연결 다시"
        }
        onChange?.let { cb -> main.post { cb() } }
    }

    @Throws(IOException::class)
    fun post(url: String, token: String?, body: JSONObject): Result {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 15_000
        c.readTimeout = 15_000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        c.setRequestProperty("Accept", "application/json")
        if (token != null) c.setRequestProperty("x-ingest-token", token)
        c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val status = c.responseCode
        val stream = if (status >= 400) c.errorStream else c.inputStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        c.disconnect()
        return Result(status, text)
    }

    private fun without(a: JSONArray, index: Int): JSONArray {
        val out = JSONArray()
        for (i in 0 until a.length()) if (i != index) out.put(a.get(i))
        return out
    }
}
