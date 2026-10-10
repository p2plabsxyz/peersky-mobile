import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import BookmarkIcon from '../../assets/icons/bootstrap/bookmark.svg'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import FolderIcon from '../../assets/icons/bootstrap/folder.svg'
import MoreIcon from '../../assets/icons/bootstrap/three-dots-vertical.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { getBrowserBookmarksInFolder } from './browser-bookmarks.mjs'
import { BookmarkFolderSheet, FolderNameDialog } from './BookmarkFolderSheet'
import type { BrowserBookmark, BrowserBookmarkFolder } from './useBrowserBookmarks'

type BookmarksScreenProps = {
  bookmarks: BrowserBookmark[]
  folders: BrowserBookmarkFolder[]
  isDark: boolean
  isReady: boolean
  persistenceError: string | null
  onClose: () => void
  onCreateFolder: (title: string) => string | null
  onDeleteFolder: (folderId: string) => void
  onMoveBookmark: (url: string, folderId: string | null) => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onRenameFolder: (folderId: string, title: string) => void
}

type BookmarkListItem =
  | { kind: 'folder', folder: BrowserBookmarkFolder, count: number }
  | { kind: 'bookmark', bookmark: BrowserBookmark }

export function BookmarksScreen ({
  bookmarks,
  folders,
  isDark,
  isReady,
  persistenceError,
  onClose,
  onCreateFolder,
  onDeleteFolder,
  onMoveBookmark,
  onOpen,
  onRemove,
  onRenameFolder
}: BookmarksScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  // The folder being looked at, or null for the top of Bookmarks.
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const openFolder = folders.find((folder) => folder.id === openFolderId) || null
  const [movingUrl, setMovingUrl] = useState<string | null>(null)
  const moving = bookmarks.find((bookmark) => bookmark.url === movingUrl) || null
  // Naming a new folder, or renaming the folder with this id.
  const [nameDialog, setNameDialog] = useState<'create' | { renameId: string } | null>(null)
  const renaming = nameDialog !== null && nameDialog !== 'create'
    ? folders.find((folder) => folder.id === nameDialog.renameId) || null
    : null

  // Folders first, then the bookmarks not in one; inside a folder, its own.
  const items: BookmarkListItem[] = openFolder
    ? getBrowserBookmarksInFolder(bookmarks, openFolder.id).map((bookmark: BrowserBookmark) => ({ kind: 'bookmark' as const, bookmark }))
    : [
        ...folders.map((folder) => ({
          kind: 'folder' as const,
          folder,
          count: getBrowserBookmarksInFolder(bookmarks, folder.id).length
        })),
        ...getBrowserBookmarksInFolder(bookmarks, null).map((bookmark: BrowserBookmark) => ({ kind: 'bookmark' as const, bookmark }))
      ]

  function folderActions (folder: BrowserBookmarkFolder) {
    Alert.alert(folder.title, undefined, [
      { text: 'Rename', onPress: () => setNameDialog({ renameId: folder.id }) },
      {
        text: 'Delete folder',
        style: 'destructive',
        onPress: () => {
          onDeleteFolder(folder.id)
          if (openFolderId === folder.id) setOpenFolderId(null)
        }
      },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel={openFolder ? 'Back to Bookmarks' : 'Close Bookmarks'}
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
          onPress={() => openFolder ? setOpenFolderId(null) : onClose()}
        >
          <ArrowLeftIcon width={22} height={22} color={palette.text} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {openFolder ? openFolder.title : 'Bookmarks'}
        </Text>
        {isReady && (openFolder
          ? (
            <Pressable
              accessibilityLabel={`Rename or delete ${openFolder.title}`}
              accessibilityRole='button'
              hitSlop={10}
              style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
              onPress={() => folderActions(openFolder)}
            >
              <MoreIcon width={20} height={20} color={palette.text} />
            </Pressable>
            )
          : (
            <Pressable
              accessibilityRole='button'
              hitSlop={8}
              style={({ pressed }) => [styles.newFolderButton, pressed ? styles.pressed : null]}
              onPress={() => setNameDialog('create')}
            >
              <PlusIcon width={15} height={15} color={palette.accent} />
              <Text style={[styles.newFolderText, { color: palette.accent }]}>New folder</Text>
            </Pressable>
            ))}
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
        : items.length === 0
        ? (
          <View style={styles.empty}>
            {openFolder
              ? <FolderIcon width={30} height={30} color={palette.mutedText} />
              : <BookmarkIcon width={30} height={30} color={palette.mutedText} />}
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {openFolder ? 'Nothing in this folder' : 'No bookmarks yet'}
            </Text>
            <Text style={[styles.emptyCopy, { color: palette.mutedText }]}>
              {openFolder
                ? 'Move a bookmark here with the folder button next to it.'
                : 'Tap the star in the address bar to bookmark a page.'}
            </Text>
          </View>
          )
        : (
          <FlatList
            contentContainerStyle={styles.list}
            data={items}
            keyExtractor={(item) => item.kind === 'folder' ? item.folder.id : item.bookmark.url}
            renderItem={({ item }) => item.kind === 'folder'
              ? (
                <Pressable
                  accessibilityHint='Press and hold to rename or delete it'
                  accessibilityLabel={`${item.folder.title}, ${item.count} bookmark${item.count === 1 ? '' : 's'}`}
                  accessibilityRole='button'
                  style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed ? styles.pressed : null]}
                  onLongPress={() => folderActions(item.folder)}
                  onPress={() => setOpenFolderId(item.folder.id)}
                >
                  <View style={[styles.favicon, { backgroundColor: palette.surface }]}>
                    <FolderIcon width={18} height={18} color={palette.text} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>{item.folder.title}</Text>
                    <Text style={[styles.rowUrl, { color: palette.mutedText }]}>
                      {item.count} bookmark{item.count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <ChevronRightIcon width={16} height={16} color={palette.mutedText} />
                </Pressable>
                )
              : (
                <BookmarkRow
                  bookmark={item.bookmark}
                  palette={palette}
                  onMove={() => setMovingUrl(item.bookmark.url)}
                  onOpen={onOpen}
                  onRemove={onRemove}
                />
                )}
          />
          )}
      <BookmarkFolderSheet
        currentFolder={moving?.folder || null}
        folders={folders}
        isDark={isDark}
        title='Move to folder'
        visible={moving !== null}
        onClose={() => setMovingUrl(null)}
        onCreateFolder={onCreateFolder}
        onPick={(folderId) => {
          if (moving) onMoveBookmark(moving.url, folderId)
        }}
      />
      <FolderNameDialog
        initialName={renaming?.title || ''}
        isDark={isDark}
        title={renaming ? 'Rename folder' : 'New folder'}
        visible={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        onSave={(name) => {
          if (renaming) onRenameFolder(renaming.id, name)
          else onCreateFolder(name)
        }}
      />
    </View>
  )
}

function BookmarkRow ({
  bookmark,
  palette,
  onMove,
  onOpen,
  onRemove
}: {
  bookmark: BrowserBookmark
  palette: typeof BROWSER_PALETTES.light
  onMove: () => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
}) {
  return (
              <View
                style={[styles.row, { borderBottomColor: palette.border }]}
              >
                <Pressable
                  accessibilityRole='link'
                  style={({ pressed }) => [styles.rowBody, pressed ? styles.pressed : null]}
                  onPress={() => onOpen(bookmark.url)}
                >
                  <View style={[styles.favicon, { backgroundColor: palette.surface }]}>
                    {bookmark.favicon
                      ? <Image source={{ uri: bookmark.favicon }} style={styles.faviconImage} />
                      : <BookmarkIcon width={17} height={17} color={palette.mutedText} />}
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                      {bookmark.title}
                    </Text>
                    <Text style={[styles.rowUrl, { color: palette.mutedText }]} numberOfLines={1}>
                      {bookmark.url}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Move ${bookmark.title} to a folder`}
                  accessibilityRole='button'
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeButton, pressed ? styles.pressed : null]}
                  onPress={onMove}
                >
                  <FolderIcon width={19} height={19} color={palette.mutedText} />
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
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    marginLeft: 4
  },
  newFolderButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 8
  },
  newFolderText: {
    fontSize: 15,
    fontWeight: '700'
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
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    minHeight: 72,
    paddingVertical: 12
  },
  favicon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    width: 34
  },
  faviconImage: {
    height: 26,
    width: 26
  },
  rowCopy: {
    flex: 1
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
