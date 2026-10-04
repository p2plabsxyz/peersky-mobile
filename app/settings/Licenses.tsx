import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
import { memo, useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { useSettingsDarkMode } from './SettingsUI'
import { describeNotice, parseThirdPartyNotices, splitNoticeText } from './third-party-notices.mjs'

type Notice = {
  key: string
  name: string
  version: string
  license: string
  url: string
  text: string
}

type NoticeSection = {
  id: string
  title: string
  data: Notice[]
}

// Licenses ask that their text travels with the app, so the list ships inside
// it and opens with no network. It is a .txt asset, read when this page opens,
// so its 2 MB of text stays out of the JavaScript bundle.
async function loadThirdPartyNotices () {
  const asset = Asset.fromModule(require('../../assets/licenses/third-party-notices.txt'))
  await asset.downloadAsync()
  const file = new File(asset.localUri || asset.uri)
  return parseThirdPartyNotices(await file.text()) as { sections: NoticeSection[], count: number }
}

export function Licenses ({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const isDark = useSettingsDarkMode()
  const [sections, setSections] = useState<NoticeSection[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadThirdPartyNotices()
      .then((loaded) => {
        if (!active) return
        setSections(loaded.sections)
        setCount(loaded.count)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      active = false
    }
  }, [])

  const toggle = useCallback((key: string) => {
    setOpenKey((current) => current === key ? null : key)
  }, [])

  if (error) {
    return (
      <View style={[styles.state, isDark ? darkStyles.page : null]}>
        <Text style={[styles.stateText, isDark ? darkStyles.mutedText : null]}>{error}</Text>
      </View>
    )
  }

  if (!sections) {
    return (
      <View style={[styles.state, isDark ? darkStyles.page : null]}>
        <ActivityIndicator color={isDark ? BROWSER_PALETTES.dark.text : '#1f6fd1'} />
      </View>
    )
  }

  return (
    <SectionList
      style={[styles.page, isDark ? darkStyles.page : null]}
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      initialNumToRender={24}
      ListHeaderComponent={(
        <Text style={[styles.intro, isDark ? darkStyles.mutedText : null]}>
          PeerSky is free software under the MIT License. It is built on the
          work of the people and projects below, {count} in all, each under
          its own license. Tap one to read it.
        </Text>
      )}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.sectionTitle, isDark ? darkStyles.sectionTitle : null]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <NoticeRow
          item={item}
          open={item.key === openKey}
          isDark={isDark}
          onToggle={toggle}
          onOpenUrl={onOpenUrl}
        />
      )}
    />
  )
}

const NoticeRow = memo(function NoticeRow ({
  item,
  open,
  isDark,
  onToggle,
  onOpenUrl
}: {
  item: Notice
  open: boolean
  isDark: boolean
  onToggle: (key: string) => void
  onOpenUrl: (url: string) => void
}) {
  return (
    <View style={[styles.row, isDark ? darkStyles.row : null]}>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides the license' : 'Shows the license'}
        style={({ pressed }) => [styles.rowButton, pressed ? styles.pressed : null]}
        onPress={() => onToggle(item.key)}
      >
        <Text style={[styles.name, isDark ? darkStyles.text : null]}>{item.name}</Text>
        <Text style={[styles.meta, isDark ? darkStyles.mutedText : null]}>{describeNotice(item)}</Text>
      </Pressable>
      {open && (
        <View style={styles.details}>
          {item.url !== '' && (
            <Pressable accessibilityRole='link' onPress={() => onOpenUrl(item.url)}>
              <Text style={[styles.link, isDark ? darkStyles.link : null]}>{item.url}</Text>
            </Pressable>
          )}
          {splitNoticeText(item.text).map((piece, index) => (
            <Text key={index} selectable style={[styles.licenseText, isDark ? darkStyles.text : null]}>{piece}</Text>
          ))}
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flex: 1
  },
  state: {
    alignItems: 'center',
    backgroundColor: '#f5f8fc',
    flex: 1,
    justifyContent: 'center',
    padding: 24
  },
  stateText: {
    color: '#687086',
    fontSize: 14,
    textAlign: 'center'
  },
  intro: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 20,
    paddingTop: 20
  },
  sectionTitle: {
    color: '#687086',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 26,
    textTransform: 'uppercase'
  },
  row: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e6ecf5',
    borderBottomWidth: 1
  },
  rowButton: {
    gap: 2,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  pressed: {
    opacity: 0.65
  },
  name: {
    color: '#1f2a44',
    fontSize: 14,
    fontWeight: '700'
  },
  meta: {
    color: '#687086',
    fontSize: 12
  },
  details: {
    gap: 0,
    paddingBottom: 16,
    paddingHorizontal: 20
  },
  link: {
    color: '#1f6fd1',
    fontSize: 12,
    marginBottom: 10
  },
  licenseText: {
    color: '#1f2a44',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 16
  }
})

const darkStyles = StyleSheet.create({
  page: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  sectionTitle: {
    color: '#98a4b8'
  },
  row: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  text: {
    color: BROWSER_PALETTES.dark.text
  },
  mutedText: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  link: {
    color: '#93c5fd'
  }
})
