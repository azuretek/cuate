package com.azuretek.cuate

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Push notifications with the app closed (issue 347, docs/push.md). The phone gets a Firebase push token and makes a
 * 32-byte key once; the page hands both to its own server, which seals each notification with the key, so the relay
 * and Firebase carry only bytes they cannot read. PushService opens them with the same key.
 *
 * Firebase is set up from build settings rather than google-services.json in the tree: the release writes that file
 * from a secret and Gradle turns it into these fields (app/build.gradle.kts). A build without it runs without push.
 */
object Push {
    /** The key PushService reads too, in the shell's SecureStore. */
    const val KEY_ACCOUNT = "push.key"

    @Volatile private var ready = false

    fun configure(context: Context): Boolean {
        if (ready) return true
        if (BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_API_KEY.isEmpty()) return false
        synchronized(this) {
            if (ready) return true
            if (FirebaseApp.getApps(context).isEmpty()) {
                val options = FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build()
                FirebaseApp.initializeApp(context.applicationContext, options)
            }
            ready = true
        }
        return true
    }

    /**
     * The registration the page sends its server, { token, platform, key }, or null where push cannot work here: no
     * Firebase build settings, notifications not allowed, or no token within the wait. Blocks, so it runs off the UI
     * thread.
     */
    fun registration(context: Context, store: SecureStore, waitSeconds: Long = 15): JSONObject? {
        if (!configure(context)) return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return null
        val done = CountDownLatch(1)
        var token: String? = null
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) token = task.result
            done.countDown()
        }
        if (!done.await(waitSeconds, TimeUnit.SECONDS)) return null
        val value = token?.takeIf { it.isNotEmpty() } ?: return null
        val key = key(store) ?: return null
        return JSONObject().put("token", value).put("platform", "android").put("key", key)
    }

    /** The phone's key, made once and kept: 32 random bytes, base64url, as the server expects. */
    fun key(store: SecureStore): String? {
        store.get(KEY_ACCOUNT)?.takeIf { it.isNotEmpty() }?.let { return it }
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        return if (store.set(KEY_ACCOUNT, value)) value else null
    }

    /** The opened payload's fields, or null for a version this build does not read. */
    fun parse(text: String): Notice? {
        val plain = JSONObject(text)
        if (plain.optInt("v") != 1) return null
        return Notice(plain.getString("chatId"), plain.getString("messageId"), plain.getString("title"), plain.getString("body"))
    }

    /** What a sealed notification says, opened with the phone's key, or null when it cannot be opened. */
    data class Notice(val chatId: String, val messageId: String, val title: String, val body: String)

    /**
     * Opens what the server sealed: base64url of a 12-byte nonce, the ciphertext and the 16-byte tag, AES-256-GCM, which
     * is Java's own layout once the nonce is split off.
     */
    fun open(sealed: String?, key: String?): Notice? {
        if (sealed.isNullOrEmpty() || key.isNullOrEmpty()) return null
        return try {
            val k = Base64.getUrlDecoder().decode(key)
            val b = Base64.getUrlDecoder().decode(sealed)
            if (k.size != 32 || b.size <= 28) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(k, "AES"), GCMParameterSpec(128, b, 0, 12))
            parse(String(cipher.doFinal(b, 12, b.size - 12), Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }
}
