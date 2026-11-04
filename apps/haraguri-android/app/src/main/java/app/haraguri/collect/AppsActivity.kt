package app.haraguri.collect

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView

/** Pick which apps' notifications are forwarded. Bank, card and pay apps are pre-checked the first time. */
class AppsActivity : Activity() {
    private class Row(val pkg: String, val label: String) { override fun toString() = label }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = Store(this)
        val pm = packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val rows = pm.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.packageName }
            .filter { it != packageName }
            .distinct()
            .map { pkg -> Row(pkg, try { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { pkg }) }
        val chosen: MutableSet<String> = if (store.packagesChosen) store.packages.toMutableSet()
            else rows.filter { FINANCE.containsMatchIn(it.label) }.map { it.pkg }.toMutableSet()
        if (!store.packagesChosen) store.packages = chosen
        val sorted = rows.sortedWith(compareByDescending<Row> { chosen.contains(it.pkg) }.thenBy { it.label.lowercase() })

        val list = ListView(this)
        list.choiceMode = ListView.CHOICE_MODE_MULTIPLE
        list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_multiple_choice, sorted)
        sorted.forEachIndexed { i, row -> list.setItemChecked(i, chosen.contains(row.pkg)) }
        list.setOnItemClickListener { _, _, position, _ ->
            val row = sorted[position]
            if (list.isItemChecked(position)) chosen.add(row.pkg) else chosen.remove(row.pkg)
            store.packages = chosen
        }
        setContentView(list)
        title = getString(R.string.apps_title)
    }

    companion object {
        /** Labels of apps that send payment or transfer alerts in Korea; messaging apps carry card-approval SMS. */
        val FINANCE = Regex("카드|뱅크|뱅킹|은행|페이|pay|토스|toss|카카오톡|메시지|messages|금고|수협|신협|증권|월렛|wallet|농협|머니|money", RegexOption.IGNORE_CASE)
    }
}
