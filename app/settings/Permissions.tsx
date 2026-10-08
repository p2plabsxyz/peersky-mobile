import { useEffect, useState } from 'react'
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { RPC_HYPER_LAN_STATUS } from '../../backend/rpc/commands.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { LAN_PERMISSION_HELP, LAN_PERMISSION_TITLE, offerPermissionSettings } from '../permission-prompt'
import {
  hasPeerChatNotificationPermission,
  requestPeerChatNotificationPermission
} from '../peerchat/notifications'
import { formatBridgeSite } from '../browser-shell.mjs'
import type { ExternalLinkBehavior, PublishingDecision } from './useBrowserPreferences'
import {
  ChoiceGroup,
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type PermissionsProps = {
  externalLinkBehavior: ExternalLinkBehavior
  persistenceError: string | null
  publishingSites: Record<string, PublishingDecision>
  onCallRpc: (command: number, payload: Record<string, unknown>) => Promise<{ ok: boolean, lan?: { available?: boolean } }>
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
  onPublishingSiteChange: (siteId: string, decision: PublishingDecision | null) => void
}

export function Permissions ({
  externalLinkBehavior,
  persistenceError,
  publishingSites,
  onCallRpc,
  onExternalLinkBehaviorChange,
  onPublishingSiteChange
}: PermissionsProps) {
  const isDark = useSettingsDarkMode()
  const [actionError, setActionError] = useState<string | null>(null)
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false)
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null)
  // There is no asking for the local network directly. Whether nearby
  // discovery is running is the answer, refused or Wi-Fi off alike.
  const [localNetworkWorks, setLocalNetworkWorks] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const refreshPermission = async () => {
      try {
        const allowed = await hasPeerChatNotificationPermission()
        if (active) setNotificationsAllowed(allowed)
      } catch (error) {
        if (active) {
          setActionError(getActionError(error, 'Unable to read notification permission.'))
          setNotificationsAllowed(false)
        }
      }
      try {
        const response = await onCallRpc(RPC_HYPER_LAN_STATUS, {})
        if (active) setLocalNetworkWorks(response.ok && response.lan?.available === true)
      } catch {
        if (active) setLocalNetworkWorks(false)
      }
    }

    void refreshPermission()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission()
    })

    return () => {
      active = false
      subscription.remove()
    }
  }, [onCallRpc])

  async function openAppSettings () {
    setActionError(null)
    try {
      await Linking.openSettings()
    } catch (error) {
      setActionError(getActionError(error, 'Unable to open device settings.'))
    }
  }

  async function requestNotifications () {
    if (notificationsAllowed) {
      await openAppSettings()
      return
    }

    setActionError(null)
    setIsRequestingNotifications(true)
    try {
      const allowed = await requestPeerChatNotificationPermission()
      setNotificationsAllowed(allowed)
      if (!allowed) await Linking.openSettings()
    } catch (error) {
      setActionError(getActionError(error, 'Unable to request notification permission.'))
    } finally {
      setIsRequestingNotifications(false)
    }
  }

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {(persistenceError || actionError) && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError || actionError}</Text>
        </View>
      )}

      <SettingsSection title='Device access'>
        <PermissionRow
          title='Camera, microphone, and location'
          description='Websites ask through the native permission prompt. Manage previously allowed or denied access in device settings.'
          action='Open settings'
          isDark={isDark}
          onPress={() => void openAppSettings()}
        />
        <PermissionRow
          title='Notifications'
          description={notificationsAllowed
            ? 'Notifications are allowed. Tap Allowed to manage or disable them in device settings.'
            : 'Allow PeerSky to display notifications. You can change this later in device settings.'}
          action={isRequestingNotifications
            ? 'Requesting...'
            : notificationsAllowed
              ? 'Allowed'
              : 'Allow'}
          disabled={isRequestingNotifications || notificationsAllowed === null}
          isDark={isDark}
          onPress={() => void requestNotifications()}
        />
        <PermissionRow
          title='Local network'
          description={localNetworkWorks === false
            ? 'Nearby devices cannot reach PeerSky right now. Local network access may be turned off for PeerSky, or Wi-Fi is off.'
            : 'Lets nearby PeerSky devices find this one and connect to it over Wi-Fi, with no internet needed.'}
          action={localNetworkWorks === null ? 'Checking...' : localNetworkWorks ? 'Allowed' : 'Turn on'}
          disabled={localNetworkWorks === null}
          isDark={isDark}
          onPress={() => {
            if (localNetworkWorks) void openAppSettings()
            else offerPermissionSettings(LAN_PERMISSION_TITLE, LAN_PERMISSION_HELP)
          }}
        />
      </SettingsSection>

      <SettingsSection title='External app links'>
        <ChoiceGroup
          options={[
            { id: 'ask', title: 'Ask every time' },
            { id: 'allow', title: 'Always allow' },
            { id: 'block', title: 'Block external links' }
          ]}
          selected={externalLinkBehavior}
          onSelect={onExternalLinkBehaviorChange}
        />
      </SettingsSection>

      <View style={styles.notice}>
        <Text style={[styles.noticeText, isDark ? styles.noticeTextDark : null]}>
          Controls links that open email (mailto:), phone (tel:), messaging (sms:), and map (geo:) apps. Web and Hyper links continue to open in PeerSky. Always allow skips confirmation, so only enable it if you trust the sites you visit.
        </Text>
      </View>

      <SettingsSection title='Publishing from sites'>
        {Object.keys(publishingSites).length === 0
          ? (
            <View style={[styles.permissionRow, isDark ? styles.permissionRowDark : null]}>
              <SettingCopy
                title='No site has asked yet'
                description='A site asks before it creates hyper:// drives on this phone or saves files to them. Your answers show up here.'
              />
            </View>
            )
          : Object.entries(publishingSites).map(([siteId, decision]) => (
            <PermissionRow
              key={siteId}
              title={formatBridgeSite(siteId)}
              description={decision === 'allow' ? 'Can publish from this phone.' : 'Blocked from publishing.'}
              action='Forget'
              isDark={isDark}
              onPress={() => onPublishingSiteChange(siteId, null)}
            />
          ))}
      </SettingsSection>
    </View>
  )
}

function PermissionRow ({
  title,
  description,
  action,
  disabled = false,
  isDark,
  onPress
}: {
  title: string
  description: string
  action: string
  disabled?: boolean
  isDark: boolean
  onPress: () => void
}) {
  return (
    <View style={[styles.permissionRow, isDark ? styles.permissionRowDark : null]}>
      <SettingCopy title={title} description={description} />
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={({ pressed }) => [
          styles.actionButton,
          isDark ? styles.actionButtonDark : null,
          pressed ? styles.actionButtonPressed : null,
          disabled ? styles.actionButtonDisabled : null
        ]}
        onPress={onPress}
      >
        <Text style={[styles.actionText, isDark ? styles.actionTextDark : null]}>{action}</Text>
      </Pressable>
    </View>
  )
}

function getActionError (error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  notice: {
    paddingHorizontal: 20,
    paddingVertical: 16
  },
  noticeText: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 18
  },
  noticeTextDark: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  errorBanner: {
    backgroundColor: '#fff1f3',
    borderBottomColor: '#efb8c2',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  errorText: {
    color: '#8f2940',
    fontSize: 13,
    lineHeight: 18
  },
  permissionRow: {
    alignItems: 'center',
    borderBottomColor: '#e6ecf5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  permissionRowDark: {
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  actionButton: {
    backgroundColor: '#edf5ff',
    borderRadius: 9,
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  actionButtonDark: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  actionButtonPressed: {
    opacity: 0.65
  },
  actionButtonDisabled: {
    opacity: 0.45
  },
  actionText: {
    color: '#1f6fd1',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center'
  },
  actionTextDark: {
    color: BROWSER_PALETTES.dark.selectedControl
  }
})
