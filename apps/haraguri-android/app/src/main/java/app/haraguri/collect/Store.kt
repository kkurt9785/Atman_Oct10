package app.haraguri.collect

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Everything the app remembers: the collection token, which apps to forward, a send queue and a short delivery log. */
class Store(ctx: Context) {
    private val p: SharedPreferences = ctx.applicationContext.getSharedPreferences("haraguri", Context.MODE_PRIVATE)

    var token: String?
        get() = p.getString("token", null)
        set(v) { p.edit().putString("token", v).apply() }

    var ingestUrl: String
        get() = p.getString("ingest_url", null) ?: INGEST_URL
        set(v) { p.edit().putString("ingest_url", v).apply() }

    /** Packages whose notifications are forwarded. Absent (not yet chosen) differs from empty. */
    var packages: Set<String>
        get() = p.getStringSet("packages", null)?.toSet() ?: emptySet()
        set(v) { p.edit().putStringSet("packages", v.toSet()).apply() }
    val packagesChosen: Boolean get() = p.contains("packages")

    var pairedAt: Long
        get() = p.getLong("paired_at", 0L)
        set(v) { p.edit().putLong("paired_at", v).apply() }

    var sent: Int
        get() = p.getInt("sent", 0)
        set(v) { p.edit().putInt("sent", v).apply() }

    var lastSentAt: Long
        get() = p.getLong("last_sent_at", 0L)
        set(v) { p.edit().putLong("last_sent_at", v).apply() }

    /** Notifications Android 15+ redacted before we saw them (see NotificationListener). */
    var hiddenCount: Int
        get() = p.getInt("hidden", 0)
        set(v) { p.edit().putInt("hidden", v).apply() }

    var queue: JSONArray
        get() = array("queue")
        set(v) { p.edit().putString("queue", v.toString()).apply() }

    var log: JSONArray
        get() = array("log")
        set(v) { p.edit().putString("log", v.toString()).apply() }

    fun appendLog(entry: JSONObject) {
        val current = log
        val next = JSONArray()
        next.put(entry)
        val keep = minOf(current.length(), LOG_SIZE - 1)
        for (i in 0 until keep) next.put(current.getJSONObject(i))
        log = next
    }

    private fun array(key: String): JSONArray = try { JSONArray(p.getString(key, null) ?: "[]") } catch (_: Exception) { JSONArray() }

    companion object {
        const val SUPABASE = "https://rwyvqxkweqsoositvlht.supabase.co"
        const val INGEST_URL = "$SUPABASE/functions/v1/ingest"
        const val PAIR_URL = "$SUPABASE/functions/v1/shortcut-pair"
        const val LOG_SIZE = 30
        val PAIR_CODE = Regex("^[0-9a-f]{48}$")
    }
}
