package app.haraguri.collect

import android.content.Context
import org.json.JSONObject
import java.io.IOException

/** Claims a five-minute pairing code minted by the web app and keeps the collection token it returns. */
object Pairing {
    class Failed(message: String) : Exception(message)

    @Throws(Failed::class)
    fun claim(ctx: Context, code: String) {
        if (!Store.PAIR_CODE.matches(code)) throw Failed("연결 코드 형식이 아니에요. 하라구리에서 ‘갤럭시 앱으로 연결’을 다시 눌러 주세요.")
        val r = try { Sender.post(Store.PAIR_URL, null, JSONObject().put("code", code)) } catch (_: IOException) { throw Failed("인터넷에 연결되지 않아요. 잠시 후 다시 시도해 주세요.") }
        val json = try { JSONObject(r.body) } catch (_: Exception) { JSONObject() }
        val token = json.optString("token", "")
        if (r.status !in 200..299 || token.isEmpty()) throw Failed(json.optString("error", "연결하지 못했어요. 하라구리에서 연결을 다시 눌러 주세요."))
        val store = Store(ctx)
        store.token = token
        json.optString("ingest_url", "").takeIf { it.startsWith("https://") }?.let { store.ingestUrl = it }
        store.pairedAt = System.currentTimeMillis()
        // Tell the family space the Galaxy app is connected (the web app shows it as 연결 테스트 ✓).
        Sender.enqueue(ctx, JSONObject().put("body", "하라구리 연결 테스트").put("via", "android-setup"))
    }
}
