package com.ledgerlyattendance

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle

/**
 * Android Enterprise / Samsung KME provisioning entry point.
 *
 * Android 12+ requires DPCs to implement ACTION_GET_PROVISIONING_MODE and
 * ACTION_ADMIN_POLICY_COMPLIANCE. Ledgerly always asks for fully-managed
 * (Device Owner) mode because the attendance appliance is organization-owned.
 */
class LedgerlyProvisioningActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    when (intent.action) {
      DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> returnProvisioningMode()
      DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE,
      DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL -> completeProvisioning()
      else -> finish()
    }
  }

  private fun adminExtras(): PersistableBundle? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(
        DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
        PersistableBundle::class.java,
      )
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
    }
  }

  private fun returnProvisioningMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val allowed = intent.getIntegerArrayListExtra(
        DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES,
      )
      if (allowed != null && !allowed.contains(DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE)) {
        setResult(RESULT_CANCELED)
        finish()
        return
      }
    }

    val result = Intent().apply {
      putExtra(
        DevicePolicyManager.EXTRA_PROVISIONING_MODE,
        DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE,
      )
      adminExtras()?.let {
        putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, it)
      }
    }

    setResult(RESULT_OK, result)
    finish()
  }

  private fun completeProvisioning() {
    ProvisioningConfig.persist(this, adminExtras())

    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(packageName)) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    // Kiosk is policy-driven, not automatic. This avoids recreating the previous
    // boot-loop/lock-task problem when a normal managed phone should remain usable.
    if (ProvisioningConfig.kioskEnabled(this)) {
      val admin = ComponentName(this, LedgerlyDeviceAdminReceiver::class.java)
      dpm.setLockTaskPackages(admin, arrayOf(packageName))
    }

    setResult(RESULT_OK)

    startActivity(
      Intent(this, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      },
    )
    finish()
  }
}
