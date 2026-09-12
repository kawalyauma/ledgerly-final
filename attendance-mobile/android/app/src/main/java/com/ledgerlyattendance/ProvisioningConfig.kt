package com.ledgerlyattendance

import android.content.Context
import android.os.PersistableBundle

/**
 * Small bridge between Android Enterprise/KME provisioning and the React Native app.
 *
 * Only the bootstrap token is treated as a secret. It is encrypted with the existing
 * Android Keystore-backed CryptoVault and is cleared only after the app confirms that
 * it successfully exchanged the token with the Ledgerly backend.
 */
object ProvisioningConfig {
  private const val PREFS = "ledgerly_provisioning"
  private const val KEY_SERVER = "server_url"
  private const val KEY_ORGANIZATION = "organization_id"
  private const val KEY_DEVICE_ALIAS = "device_alias"
  private const val KEY_KIOSK_ENABLED = "kiosk_enabled"
  private const val KEY_TOKEN = "enrollment_token_encrypted"
  private const val KEY_PROVISIONED_AT = "provisioned_at"

  fun persist(context: Context, extras: PersistableBundle?) {
    if (extras == null) return

    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()

    // KME supplies its EMM Server URI as kmeUri. A custom Ledgerly profile may
    // instead use ledgerly_server/server_url in DPC extras.
    val server = extras.getString("ledgerly_server")
      ?: extras.getString("server_url")
      ?: extras.getString("kmeUri")
    if (!server.isNullOrBlank()) editor.putString(KEY_SERVER, server.trim())

    extras.getString("organization_id")
      ?.takeIf { it.isNotBlank() }
      ?.let { editor.putString(KEY_ORGANIZATION, it) }

    extras.getString("device_alias")
      ?.takeIf { it.isNotBlank() }
      ?.let { editor.putString(KEY_DEVICE_ALIAS, it) }

    if (extras.containsKey("kiosk_enabled")) {
      editor.putBoolean(KEY_KIOSK_ENABLED, extras.getBoolean("kiosk_enabled", false))
    }

    extras.getString("enrollment_token")
      ?.takeIf { it.isNotBlank() }
      ?.let { editor.putString(KEY_TOKEN, CryptoVault.encrypt(it)) }

    editor.putLong(KEY_PROVISIONED_AT, System.currentTimeMillis()).apply()
  }

  fun serverUrl(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SERVER, null)

  fun organizationId(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ORGANIZATION, null)

  fun deviceAlias(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DEVICE_ALIAS, null)

  fun kioskEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_KIOSK_ENABLED, false)

  fun provisionedAt(context: Context): Long =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_PROVISIONED_AT, 0L)

  fun enrollmentToken(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val encrypted = prefs.getString(KEY_TOKEN, null) ?: return null
    return try {
      CryptoVault.decrypt(encrypted)
    } catch (_: Exception) {
      prefs.edit().remove(KEY_TOKEN).apply()
      null
    }
  }

  fun clearEnrollmentToken(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_TOKEN)
      .apply()
  }
}
