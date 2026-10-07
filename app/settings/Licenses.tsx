import { Asset } from 'expo-asset'
import { File, Paths } from 'expo-file-system'
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

const COPY_PREFIX = 'third-party-notices-'

// Licenses ask that their text travels with the app, so the list ships inside
// it and opens with no network. It is a .txt asset, read when this page opens,
// so its 2 MB of text stays out of the JavaScript bundle. On iOS the asset
// stays in the app bundle, which expo-file-system copies from but will not
// read ("Missing permission"), so the page reads a copy in the cache, named by
// the asset's hash so a new version of the app makes a new one.
async function loadThirdPartyNotices () {
  const asset = await Asset.fromModule(require('../../assets/licenses/third-party-notices.txt')).downloadAsync()
  if (!asset.localUri) throw new Error('The licenses file is missing from the app.')
  const copy = new File(Paths.cache, `${COPY_PREFIX}${asset.hash || 'bundled'}.txt`)
  for (const item of Paths.cache.list()) {
    if (item instanceof File && item.name.startsWith(COPY_PREFIX) && item.name !== copy.name) item.delete()
  }
  if (!copy.exists) new File(asset.localUri).copy(copy)
  try {
    return parseThirdPartyNotices(await copy.text(), Platform.OS) as { sections: NoticeSection[], count: number }
  } catch (error) {
    // A copy cut short is made again next time.
    copy.delete()
    throw error
  }
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
