import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native'
import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'
import { formatBrowserAddress } from './browser-appearance.mjs'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { styles } from './styles'

type BrowserToolbarProps = {
  address: string
  canGoBack: boolean
  canGoForward: boolean
  isDark: boolean
  isLoading: boolean
  menuVisible: boolean
  palette: {
    accent: string
    address: string
    border: string
    button: string
    mutedText: string
    shell: string
    text: string
  }
  position: 'top' | 'bottom'
  showFullAddress: boolean
  tabCount: number
  onAddressChange: (address: string) => void
  onBack: () => void
  onCloseMenu: () => void
  onForward: () => void
  onOpenMenu: () => void
  onOpenSettings: () => void
  onOpenTabs: () => void
  onReload: () => void
  onSubmit: () => void
}

export function BrowserToolbar ({
  address,
  canGoBack,
  canGoForward,
  isDark,
  isLoading,
  menuVisible,
  palette,
  position,
  showFullAddress,
  tabCount,
  onAddressChange,
  onBack,
  onCloseMenu,
  onForward,
  onOpenMenu,
  onOpenSettings,
  onOpenTabs,
  onReload,
  onSubmit
}: BrowserToolbarProps) {
  const [isAddressFocused, setIsAddressFocused] = useState(false)
  const [menuOffset, setMenuOffset] = useState(70)

  return (
    <View style={[
      styles.browserToolbar,
      {
        backgroundColor: palette.shell,
        borderBottomColor: palette.border
      },
      position === 'bottom'
        ? {
            borderBottomWidth: 0,
            borderTopColor: palette.border,
            borderTopWidth: 1
          }
        : null
    ]} onLayout={(event) => setMenuOffset(event.nativeEvent.layout.height + 4)}>
      <Pressable
        accessibilityLabel='Go back'
        style={[
          styles.browserNavButton,
          { backgroundColor: palette.button },
          !canGoBack ? styles.browserNavButtonDisabled : null
        ]}
        onPress={onBack}
        disabled={!canGoBack}
      >
        <Text style={[styles.browserNavButtonText, { color: palette.text }]}>{'<'}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel='Go forward'
        style={[
          styles.browserNavButton,
          { backgroundColor: palette.button },
          !canGoForward ? styles.browserNavButtonDisabled : null
        ]}
        onPress={onForward}
        disabled={!canGoForward}
      >
        <Text style={[styles.browserNavButtonText, { color: palette.text }]}>{'>'}</Text>
      </Pressable>
      <TextInput
        accessibilityLabel='Browser address'
        style={[
          styles.browserAddress,
          {
            backgroundColor: palette.address,
            borderColor: palette.border,
            color: palette.text
          }
        ]}
        autoCapitalize='none'
        autoCorrect={false}
        keyboardType='url'
        returnKeyType='go'
        maxLength={MAX_BROWSER_URL_LENGTH}
        value={isAddressFocused ? address : formatBrowserAddress(address, showFullAddress)}
        onFocus={() => setIsAddressFocused(true)}
        onBlur={() => setIsAddressFocused(false)}
        onChangeText={onAddressChange}
        onSubmitEditing={onSubmit}
        placeholder='Search or type'
        placeholderTextColor={palette.mutedText}
      />
      <Pressable
        accessibilityLabel={isLoading ? 'Page loading' : 'Reload page'}
        style={[styles.browserActionButton, { backgroundColor: palette.accent }]}
        onPress={onReload}
      >
        {isLoading
          ? <ActivityIndicator color='#ffffff' size='small' />
          : <Text style={styles.browserActionButtonText}>↻</Text>}
      </Pressable>
      <Pressable
        accessibilityLabel={`Open tabs, ${tabCount} open`}
        style={[styles.browserTabCountButton, { backgroundColor: palette.button }]}
        onPress={onOpenTabs}
      >
        <View style={[styles.browserTabCountIcon, { borderColor: palette.text }]}>
          <Text style={[styles.browserTabCountText, { color: palette.text }]}>{tabCount}</Text>
        </View>
      </Pressable>
      <BrowserOverflowMenu
        isDark={isDark}
        offset={menuOffset}
        position={position}
        visible={menuVisible}
        onClose={onCloseMenu}
        onShow={onOpenMenu}
        onOpenSettings={onOpenSettings}
      />
    </View>
  )
}
