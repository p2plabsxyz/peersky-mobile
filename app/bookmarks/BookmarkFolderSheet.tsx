import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BookmarksIcon from '../../assets/icons/bootstrap/bookmarks.svg'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import FolderIcon from '../../assets/icons/bootstrap/folder.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'
import type { BrowserBookmarkFolder } from './useBrowserBookmarks'

/**
 * Where a bookmark goes: the top of Bookmarks or one of its folders, with a
 * new folder made on the spot. Opened from a bookmark in the list, and from
 * the toast after bookmarking a page.
 */
export function BookmarkFolderSheet ({
  currentFolder,
  folders,
  isDark,
  title = 'Add to folder',
  visible,
  onClose,
  onCreateFolder,
  onPick
}: {
  currentFolder: string | null
  folders: BrowserBookmarkFolder[]
  isDark: boolean
  title?: string
  visible: boolean
  onClose: () => void
  // The new folder's id, or null when it could not be made.
  onCreateFolder: (title: string) => string | null
  // Where it went, by id and by the name shown for it.
  onPick: (folderId: string | null, title: string) => void
}) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const insets = useSafeAreaInsets()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (visible) return
    setNaming(false)
    setName('')
  }, [visible])

  function pick (folderId: string | null, title: string) {
    onPick(folderId, title)
    onClose()
  }

  function createAndPick () {
    const folderId = onCreateFolder(name)
    if (folderId) pick(folderId, name.trim())
  }

  const row = (pressed: boolean) => [styles.row, pressed ? { backgroundColor: palette.button } : null]

  return (
    <Modal
      animationType='fade'
      supportedOrientations={MODAL_ORIENTATIONS}
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      {/* The name field is at the bottom, where the keyboard comes up. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable accessibilityLabel='Close' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.shell, paddingBottom: insets.bottom + 12 }]}>
          <Text accessibilityRole='header' style={[styles.title, { color: palette.text }]}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps='handled' style={styles.list}>
            <Pressable
              accessibilityRole='button'
              accessibilityState={{ selected: currentFolder === null }}
              style={({ pressed }) => row(pressed)}
              onPress={() => pick(null, 'Bookmarks')}
            >
              <BookmarksIcon width={19} height={19} color={palette.text} />
              <Text style={[styles.rowText, { color: palette.text }]}>Bookmarks</Text>
              {currentFolder === null && <CheckIcon width={18} height={18} color={palette.accent} />}
            </Pressable>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                accessibilityRole='button'
                accessibilityState={{ selected: currentFolder === folder.id }}
                style={({ pressed }) => row(pressed)}
                onPress={() => pick(folder.id, folder.title)}
              >
                <FolderIcon width={19} height={19} color={palette.text} />
                <Text numberOfLines={1} style={[styles.rowText, { color: palette.text }]}>{folder.title}</Text>
                {currentFolder === folder.id && <CheckIcon width={18} height={18} color={palette.accent} />}
              </Pressable>
            ))}
            {naming
              ? (
                <View style={styles.nameRow}>
                  <TextInput
                    autoFocus
                    accessibilityLabel='Folder name'
                    maxLength={64}
                    placeholder='Folder name'
                    placeholderTextColor={palette.mutedText}
                    returnKeyType='done'
                    style={[styles.input, { borderColor: palette.border, color: palette.text }]}
                    value={name}
                    onChangeText={setName}
                    onSubmitEditing={createAndPick}
                  />
                  <Pressable
                    accessibilityRole='button'
                    accessibilityState={{ disabled: !name.trim() }}
                    disabled={!name.trim()}
                    style={[styles.createButton, !name.trim() ? styles.disabled : null]}
                    onPress={createAndPick}
                  >
                    <Text style={styles.createText}>Create</Text>
                  </Pressable>
                </View>
                )
              : (
                <Pressable
                  accessibilityRole='button'
                  style={({ pressed }) => row(pressed)}
                  onPress={() => setNaming(true)}
                >
                  <PlusIcon width={18} height={18} color={palette.accent} />
                  <Text style={[styles.rowText, { color: palette.accent }]}>New folder</Text>
                </Pressable>
                )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** A name for a new folder, or a new name for one. */
export function FolderNameDialog ({
  initialName = '',
  isDark,
  title,
  visible,
  onClose,
  onSave
}: {
  initialName?: string
  isDark: boolean
  title: string
  visible: boolean
  onClose: () => void
  onSave: (name: string) => void
}) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (visible) setName(initialName)
  }, [initialName, visible])

  function save () {
    if (!name.trim()) return
    onSave(name)
    onClose()
  }

  return (
    <Modal
      animationType='fade'
      supportedOrientations={MODAL_ORIENTATIONS}
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.dialogBackdrop}>
        <View style={[styles.dialog, { backgroundColor: palette.shell }]}>
          <Text accessibilityRole='header' style={[styles.title, styles.dialogTitle, { color: palette.text }]}>{title}</Text>
          <TextInput
            autoFocus
            accessibilityLabel='Folder name'
            maxLength={64}
            placeholder='Folder name'
            placeholderTextColor={palette.mutedText}
            returnKeyType='done'
            selectTextOnFocus
            style={[styles.input, styles.dialogInput, { borderColor: palette.border, color: palette.text }]}
            value={name}
            onChangeText={setName}
            onSubmitEditing={save}
          />
          <View style={styles.dialogActions}>
            <Pressable accessibilityRole='button' hitSlop={8} onPress={onClose}>
              <Text style={[styles.dialogButton, { color: palette.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityState={{ disabled: !name.trim() }}
              disabled={!name.trim()}
              hitSlop={8}
              onPress={save}
            >
              <Text style={[styles.dialogButton, styles.dialogButtonStrong, !name.trim() ? styles.disabled : null]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1
  },
  backdrop: {
    backgroundColor: 'rgba(10, 14, 22, 0.35)',
    flex: 1
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '70%',
    paddingTop: 18
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingBottom: 8
  },
  list: {
    flexGrow: 0
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 20
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600'
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16
  },
  createText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  disabled: {
    opacity: 0.45
  },
  dialogBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 22, 0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: 24
  },
  dialog: {
    borderRadius: 16,
    maxWidth: 420,
    paddingBottom: 14,
    paddingTop: 18,
    width: '100%'
  },
  dialogTitle: {
    paddingBottom: 12
  },
  dialogInput: {
    flex: 0,
    marginHorizontal: 20
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 28,
    justifyContent: 'flex-end',
    paddingHorizontal: 22,
    paddingTop: 16
  },
  dialogButton: {
    fontSize: 16,
    fontWeight: '700'
  },
  dialogButtonStrong: {
    color: '#1f6fd1'
  }
})
