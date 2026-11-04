package app.haraguri.collect

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/** Forwards notifications from the chosen apps as {title, body, app, via:"android"} — the same shape the iPhone shortcut sends. */
class NotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        val store = Store(this)
        if (!store.packages.contains(sbn.packageName)) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n") { it.toString().trim() }
        val body = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString()?.trim().orEmpty().ifEmpty { lines.orEmpty() }
        if (title.isEmpty() && body.isEmpty()) return
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) android.util.Log.i(TAG, "posted ${sbn.packageName} id=${sbn.id} tag=${sbn.tag} title=[$title] body=[${body.take(60)}] keys=${extras.keySet().joinToString(",")}")
        if (Recent.seen("${sbn.packageName}|$title|$body")) return
        // Android 15+ hides notifications it takes for one-time codes from listeners without RECEIVE_SENSITIVE_NOTIFICATIONS
        // (card approvals with a 4-digit card suffix trip the detector). Nothing useful arrives; record it so the screen can say so.
        if (body == redactedMessage()) {
            store.appendLog(JSONObject().put("at", System.currentTimeMillis()).put("app", appLabel(sbn.packageName)).put("title", "").put("status", "hidden"))
            store.hiddenCount = store.hiddenCount + 1
            Sender.notifyChanged()
            return
        }
        Sender.enqueue(this, JSONObject()
            .put("title", title)
            .put("body", body)
            .put("app", appLabel(sbn.packageName))
            .put("via", "android"))
    }

    /** The system's own localized placeholder text, so the check holds in every language. */
    private fun redactedMessage(): String? {
        val id = android.content.res.Resources.getSystem().getIdentifier("redacted_notification_message", "string", "android")
        return if (id == 0) null else try { android.content.res.Resources.getSystem().getString(id) } catch (_: Exception) { null }
    }

    private fun appLabel(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) { pkg }

    /** Samsung and several bank apps re-post the same notification within a second or two; send each once. */
    private object Recent {
        private val seen = LinkedHashMap<String, Long>()
        @Synchronized fun seen(key: String): Boolean {
            val now = System.currentTimeMillis()
            seen.entries.removeAll { now - it.value > WINDOW_MS }
            if (seen.containsKey(key)) return true
            seen[key] = now
            return false
        }
        private const val WINDOW_MS = 10_000L
    }

    companion object { private const val TAG = "HaraguriListener" }
}
