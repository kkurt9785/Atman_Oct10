package app.haraguri.collect

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateFormat
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.util.concurrent.Executors

/** One screen: connection, notification access, chosen apps, battery, recent deliveries. */
class MainActivity : Activity() {
    private val exec = Executors.newSingleThreadExecutor()
    private lateinit var store: Store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)
        findViewById<Button>(R.id.btn_claim).setOnClickListener { claim(findViewById<EditText>(R.id.et_code).text.toString().trim()) }
        findViewById<Button>(R.id.btn_access).setOnClickListener { openListenerSettings() }
        findViewById<Button>(R.id.btn_apps).setOnClickListener { startActivity(Intent(this, AppsActivity::class.java)) }
        findViewById<Button>(R.id.btn_battery).setOnClickListener { requestBatteryException() }
        findViewById<Button>(R.id.btn_test).setOnClickListener {
            Sender.enqueue(this, JSONObject().put("body", "하라구리 연결 테스트").put("via", "android-setup"))
            Toast.makeText(this, R.string.test_sent, Toast.LENGTH_SHORT).show()
        }
        findViewById<Button>(R.id.btn_unpair).setOnClickListener { store.token = null; store.pairedAt = 0L; render() }
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        Sender.onChange = { render() }
        Sender.flush(this)
        render()
    }

    override fun onPause() {
        super.onPause()
        Sender.onChange = null
    }

    /** haraguri://pair?code=… from the web app. */
    private fun handle(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme == "haraguri" && data.host == "pair") {
            intent.data = null
            data.getQueryParameter("code")?.let { claim(it) }
        }
    }

    private fun claim(code: String) {
        if (code.isEmpty()) { Toast.makeText(this, R.string.code_empty, Toast.LENGTH_SHORT).show(); return }
        findViewById<TextView>(R.id.tv_connection).text = getString(R.string.connecting)
        exec.execute {
            val error = try { Pairing.claim(this, code); null } catch (e: Pairing.Failed) { e.message }
            runOnUiThread {
                if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show()
                else findViewById<EditText>(R.id.et_code).setText("")
                render()
            }
        }
    }

    private fun render() {
        val paired = store.token != null
        findViewById<TextView>(R.id.tv_connection).text = if (paired) getString(R.string.connected, store.sent) else getString(R.string.not_connected)
        findViewById<android.view.View>(R.id.pair_box).visibility = if (paired) android.view.View.GONE else android.view.View.VISIBLE
        findViewById<android.view.View>(R.id.btn_unpair).visibility = if (paired) android.view.View.VISIBLE else android.view.View.GONE

        val access = hasNotificationAccess(this)
        findViewById<TextView>(R.id.tv_access).text = getString(if (access) R.string.access_on else R.string.access_off)
        findViewById<Button>(R.id.btn_access).visibility = if (access) android.view.View.GONE else android.view.View.VISIBLE

        val n = store.packages.size
        findViewById<TextView>(R.id.tv_apps).text = if (!store.packagesChosen) getString(R.string.apps_unset) else resources.getQuantityString(R.plurals.apps_count, n, n)

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val ignoring = pm.isIgnoringBatteryOptimizations(packageName)
        findViewById<TextView>(R.id.tv_battery).text = getString(if (ignoring) R.string.battery_ok else R.string.battery_warn)
        findViewById<Button>(R.id.btn_battery).visibility = if (ignoring) android.view.View.GONE else android.view.View.VISIBLE

        findViewById<TextView>(R.id.tv_log).text = logText()
        val hidden = findViewById<TextView>(R.id.tv_hidden)
        hidden.visibility = if (store.hiddenCount > 0) android.view.View.VISIBLE else android.view.View.GONE
        hidden.text = getString(R.string.hidden_warn, store.hiddenCount)
    }

    private fun logText(): String {
        val log = store.log
        if (log.length() == 0) return getString(R.string.log_empty)
        val sb = StringBuilder()
        for (i in 0 until log.length()) {
            val e = log.getJSONObject(i)
            val time = DateFormat.format("M/d HH:mm", e.optLong("at")).toString()
            val status = when (e.optString("status")) {
                "saved" -> "가계부에 올렸어요"; "duplicate" -> "이미 있는 내역"; "ignored" -> "무시(안내·광고)"; "unparsed" -> "읽지 못함"; "ok" -> "전송됨"
                "hidden" -> "폰이 내용을 숨겼어요"
                else -> "전송 실패 · ${e.optString("status")}"
            }
            sb.append(time).append(" · ").append(e.optString("app").ifEmpty { "-" }).append(" · ").append(status).append('\n')
            val title = e.optString("title")
            if (title.isNotEmpty()) sb.append("   ").append(title.take(48)).append('\n')
        }
        return sb.toString().trimEnd()
    }

    private fun openListenerSettings() {
        val component = ComponentName(this, NotificationListener::class.java)
        val direct = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
        else null
        try { startActivity(direct ?: Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        catch (_: Exception) { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
    }

    private fun requestBatteryException() {
        try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(Uri.parse("package:$packageName"))) }
        catch (_: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }

    companion object {
        fun hasNotificationAccess(ctx: Context): Boolean {
            val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
            return flat.split(':').any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
        }
    }
}
