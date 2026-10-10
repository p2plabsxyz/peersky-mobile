import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { listP2pSites } from './p2p-sites.mjs'

type P2pSitesHistoryItem = { url: string, title: string, visitedAt: number }

type P2pSitesPalette = {
  accent: string
  border: string
  mutedText: string
  surface: string
  text: string
}

/**
 * peersky://p2p: the hyper:// sites this phone has opened, as a plain list
 * with a search over their titles. The pages opened stay in the phone's Hyper
 * storage, so this is also where to find a P2P site to open with no connection.
 * It used to show the same app tiles as the home screen.
 */
export function P2pSitesPage ({
  history,
  palette,
  onOpen
}: {
  history: P2pSitesHistoryItem[]
  palette: P2pSitesPalette
  onOpen: (url: string) => void
}) {
  const [query, setQuery] = useState('')
  const allSites = useMemo(() => listP2pSites(history), [history])
  const sites = useMemo(() => (query ? listP2pSites(history, query) : allSites), [allSites, history, query])

  return (
    <ScrollView
      style={[pageStyles.page, { backgroundColor: palette.surface }]}
      contentContainerStyle={pageStyles.content}
      keyboardDismissMode='on-drag'
      keyboardShouldPersistTaps='handled'
    >
      <Text accessibilityRole='header' style={[pageStyles.heading, { color: palette.text }]}>P2P sites</Text>
      <Text style={[pageStyles.note, { color: palette.mutedText }]}>
        Sites you opened over hyper://. Their pages stay on this phone, so they open without a connection.
      </Text>
      {allSites.length > 0 && (
        <TextInput
          accessibilityLabel='Search P2P sites by title'
          autoCapitalize='none'
          autoCorrect={false}
          clearButtonMode='while-editing'
          placeholder='Search by title'
          placeholderTextColor={palette.mutedText}
          returnKeyType='search'
          style={[pageStyles.search, { borderColor: palette.border, color: palette.text }]}
          value={query}
          onChangeText={setQuery}
        />
      )}
      {sites.map((site) => (
        <Pressable
          key={site.url}
          accessibilityRole='link'
          accessibilityLabel={`Open ${site.title}`}
          style={[pageStyles.row, { borderColor: palette.border }]}
          onPress={() => onOpen(site.url)}
        >
          <Text numberOfLines={2} style={[pageStyles.title, { color: palette.accent }]}>{site.title}</Text>
          <Text numberOfLines={1} style={[pageStyles.address, { color: palette.mutedText }]}>{site.url}</Text>
        </Pressable>
      ))}
      {allSites.length === 0 && (
        <View style={pageStyles.empty}>
          <Text style={{ color: palette.mutedText }}>
            No P2P sites yet. A hyper:// site you open shows up here.
          </Text>
        </View>
      )}
      {allSites.length > 0 && sites.length === 0 && (
        <View style={pageStyles.empty}>
          <Text style={{ color: palette.mutedText }}>No site has that in its title.</Text>
        </View>
      )}
    </ScrollView>
  )
}

const pageStyles = StyleSheet.create({
  address: {
    fontSize: 12,
    marginTop: 2
  },
  content: {
    paddingBottom: 32,
    paddingHorizontal: 16,
    paddingTop: 16
  },
  empty: {
    paddingVertical: 16
  },
  heading: {
    fontSize: 20,
    fontWeight: '700'
  },
  note: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: 4
  },
  page: {
    flex: 1
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10
  },
  search: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  title: {
    fontSize: 16,
    textDecorationLine: 'underline'
  }
})
