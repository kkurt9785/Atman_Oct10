// 하라구리 알림 수집 — Galaxy companion app. One module, no third-party dependencies (platform widgets + HttpURLConnection),
// so the build only needs what the SDK and the Gradle cache already hold.
plugins {
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
