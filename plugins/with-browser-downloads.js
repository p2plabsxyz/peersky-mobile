const { withDangerousMod, withMainApplication } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_REGISTRATION = 'add(BrowserDownloadsPackage())'

module.exports = function withBrowserDownloads (config) {
  config = withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('Browser downloads require a Kotlin MainApplication.')
    }

    androidConfig.modResults.contents = addPackageRegistration(androidConfig.modResults.contents)

    return androidConfig
  })

  return withDangerousMod(config, ['android', async (androidConfig) => {
    const packageName = androidConfig.android?.package
    if (!packageName) throw new Error('Android package name is required for browser downloads.')

    const sourceDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...packageName.split('.')
    )

    fs.mkdirSync(sourceDirectory, { recursive: true })
    fs.writeFileSync(
      path.join(sourceDirectory, 'BrowserDownloadsModule.kt'),
      createDownloadsModule(packageName)
    )
    fs.writeFileSync(
      path.join(sourceDirectory, 'BrowserDownloadsPackage.kt'),
      createDownloadsPackage(packageName)
    )

    return androidConfig
  }])
}

function addPackageRegistration (contents) {
  if (contents.includes(PACKAGE_REGISTRATION)) return contents

  const marker = 'PackageList(this).packages.apply {'
  if (!contents.includes(marker)) {
    throw new Error('Unable to register browser downloads in MainApplication.')
  }

  return contents.replace(
    marker,
    `${marker}\n          ${PACKAGE_REGISTRATION}`
  )
}

function createDownloadsModule (packageName) {
  return `package ${packageName}

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BrowserDownloadsModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "BrowserDownloads"

  @ReactMethod
  fun getDownloads(promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val downloads = Arguments.createArray()

      manager.query(DownloadManager.Query()).use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
        val titleIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)
        val statusIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
        val sizeIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
        val createdAtIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LAST_MODIFIED_TIMESTAMP)

        while (cursor.moveToNext() && downloads.size() < MAX_DOWNLOADS) {
          val id = cursor.getLong(idIndex)
          val status = cursor.getInt(statusIndex)
          val record = Arguments.createMap()
          record.putString("id", id.toString())
          record.putString("name", cursor.getString(titleIndex) ?: "Download")
          record.putString("status", getStatus(status))
          record.putDouble("size", cursor.getLong(sizeIndex).coerceAtLeast(0).toDouble())
          record.putDouble("createdAt", cursor.getLong(createdAtIndex).coerceAtLeast(0).toDouble())
          downloads.pushMap(record)
        }
      }

      promise.resolve(downloads)
    } catch (error: Exception) {
      promise.reject("DOWNLOADS_QUERY_FAILED", "Unable to load downloads.", error)
    }
  }

  @ReactMethod
  fun openDownload(id: String, promise: Promise) {
    val downloadId = id.toLongOrNull()
    if (downloadId == null || downloadId < 1) {
      promise.reject("INVALID_DOWNLOAD_ID", "Invalid download identifier.")
      return
    }

    try {
      val manager = reactApplicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val uri = manager.getUriForDownloadedFile(downloadId)
      if (uri == null) {
        promise.resolve(false)
        return
      }

      val mimeType = manager.getMimeTypeForDownloadedFile(downloadId)
        ?: "*/*"
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      if (intent.resolveActivity(reactApplicationContext.packageManager) == null) {
        promise.resolve(false)
        return
      }

      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_OPEN_FAILED", "Unable to open download.", error)
    }
  }

  @ReactMethod
  fun removeDownload(id: String, promise: Promise) {
    val downloadId = id.toLongOrNull()
    if (downloadId == null || downloadId < 1) {
      promise.reject("INVALID_DOWNLOAD_ID", "Invalid download identifier.")
      return
    }

    try {
      val manager = reactApplicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      promise.resolve(manager.remove(downloadId) > 0)
    } catch (error: Exception) {
      promise.reject("DOWNLOAD_REMOVE_FAILED", "Unable to remove download.", error)
    }
  }

  private fun getStatus(status: Int) = when (status) {
    DownloadManager.STATUS_PENDING -> "pending"
    DownloadManager.STATUS_RUNNING -> "running"
    DownloadManager.STATUS_PAUSED -> "paused"
    DownloadManager.STATUS_SUCCESSFUL -> "complete"
    else -> "failed"
  }

  companion object {
    private const val MAX_DOWNLOADS = 200
  }
}
`
}

function createDownloadsPackage (packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BrowserDownloadsPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(BrowserDownloadsModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`
}

module.exports.createDownloadsModule = createDownloadsModule
module.exports.createDownloadsPackage = createDownloadsPackage
module.exports.addPackageRegistration = addPackageRegistration
