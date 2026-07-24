import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import BookmarkIcon from '../../assets/icons/bootstrap/bookmark.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import type { BrowserBookmark } from './useBrowserBookmarks'

type BookmarksScreenProps = {
  bookmarks: BrowserBookmark[]
  isDark: boolean
  isReady: boolean
  persistenceError: string | null
  onClose: () => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
}

export function BookmarksScreen ({
  bookmarks,
  isDark,
  isReady,
  persistenceError,
  onClose,
  onOpen,
  onRemove
}: BookmarksScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel='Close Bookmarks'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
          onPress={onClose}
        >
          <ArrowLeftIcon width={22} height={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Bookmarks</Text>
      </View>

      {persistenceError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError}</Text>
        </View>
      )}

      {!isReady
        ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.accent} />
            <Text style={[styles.emptyCopy, { color: palette.mutedText }]}>
              Loading bookmarks...
            </Text>
          </View>
          )
        : bookmarks.length === 0
        ? (
          <View style={styles.empty}>
            <BookmarkIcon width={30} height={30} color={palette.mutedText} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No bookmarks yet</Text>
            <Text style={[styles.emptyCopy, { color: palette.mutedText }]}>
              Bookmark a website from the three-dot menu.
            </Text>
          </View>
          )
        : (
          <FlatList
            contentContainerStyle={styles.list}
            data={bookmarks}
            keyExtractor={(bookmark) => bookmark.url}
            renderItem={({ item: bookmark }) => (
              <View
                style={[styles.row, { borderBottomColor: palette.border }]}
              >
                <Pressable
                  accessibilityRole='link'
                  style={({ pressed }) => [styles.rowBody, pressed ? styles.pressed : null]}
                  onPress={() => onOpen(bookmark.url)}
                >
                  <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                    {bookmark.title}
                  </Text>
                  <Text style={[styles.rowUrl, { color: palette.mutedText }]} numberOfLines={1}>
                    {bookmark.url}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Remove ${bookmark.title}`}
                  accessibilityRole='button'
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeButton, pressed ? styles.pressed : null]}
                  onPress={() => onRemove(bookmark.url)}
                >
                  <TrashIcon width={19} height={19} color='#a7354a' />
                </Pressable>
              </View>
            )}
          />
          )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 12
  },
  backButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginLeft: 4
  },
  errorBanner: {
    backgroundColor: '#fff1f3',
    borderBottomColor: '#efb8c2',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 11
  },
  errorText: {
    color: '#8f2940',
    fontSize: 13,
    lineHeight: 18
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 32
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 13
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center'
  },
  list: {
    paddingHorizontal: 18
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 72
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 72,
    paddingVertical: 12
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700'
  },
  rowUrl: {
    fontSize: 12,
    marginTop: 4
  },
  removeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: 8,
    width: 44
  },
  pressed: {
    opacity: 0.6
  }
})
