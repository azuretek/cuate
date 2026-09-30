package com.azuretek.cuate

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The shell's secure storage: a small Keystore-backed store for the values the
 * page keeps through the host bridge (the server URL, the device token, the
 * cache key).
 *
 * The device token never leaves the Android Keystore in the clear, which is why
 * the shell owns this rather than letting the page keep it in localStorage: a
 * WebView wipes localStorage on uninstall and the values are worth keeping
 * across one. A device whose Keystore cannot be unlocked keeps the values in
 * memory for the session instead of failing, the same way the desktop degrades
 * when no keychain is available.
 */
class SecureStore(context: Context) {
    companion object {
        private const val PREFS = "cuate.secure"
        private const val ALIAS = "cuate.secure.store"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val IV_BYTES = 12
        private const val MAX_VALUE_BYTES = 8192
        private val KEY = Regex("^[a-z][a-z0-9.]{0,63}$")
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val memory = HashMap<String, String>()
    private val key: SecretKey? = key()

    fun get(key: String): String? {
        if (!validKey(key)) return null
        memory[key]?.let { return it }
        val stored = prefs.getString(key, null) ?: return null
        return decrypt(stored)
    }

    /** True when the value was written to the Keystore-backed store. */
    fun set(key: String, value: String): Boolean {
        if (!validKey(key) || value.toByteArray(Charsets.UTF_8).size > MAX_VALUE_BYTES) return false
        if (this.key == null) {
            memory[key] = value
            return false
        }
        val sealed = encrypt(value) ?: return false
        prefs.edit().putString(key, sealed).apply()
        memory.remove(key)
        return true
    }

    fun delete(key: String): Boolean {
        if (!validKey(key)) return false
        val inMemory = memory.remove(key) != null
        val inPrefs = prefs.contains(key)
        if (inPrefs) prefs.edit().remove(key).apply()
        return inMemory || inPrefs
    }

    private fun validKey(key: String?): Boolean = key != null && KEY.matches(key)

    private fun key(): SecretKey? = try {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey ?: generate()
    } catch (e: Exception) {
        null
    }

    private fun generate(): SecretKey? = try {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        generator.generateKey()
    } catch (e: Exception) {
        null
    }

    private fun encrypt(value: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(sealed, Base64.NO_WRAP)
    } catch (e: Exception) {
        null
    }

    private fun decrypt(stored: String): String? = try {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val iv = bytes.copyOfRange(0, IV_BYTES)
        val body = bytes.copyOfRange(IV_BYTES, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        String(cipher.doFinal(body), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }
}
