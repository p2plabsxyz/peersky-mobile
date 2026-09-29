import { Image, Pressable, Text, View } from 'react-native'

import { styles } from '../styles'
import type { BrowserFavourite } from './useBrowserFavourites'

/**
 * The home screen's own row of sites.
 *
 * Same tiles as the built-in apps above them, because they do the same job:
 * one press, somewhere you go often. A site's own icon when it has one, its
 * first letter when it does not, which is most of them.
 */
export function BrowserFavourites ({
  favourites,
  palette,
  onOpen,
  onRemove
}: {
  favourites: BrowserFavourite[]
  palette: { button: string, mutedText: string, text: string }
  onOpen: (url: string) => void
  onRemove: (favourite: BrowserFavourite) => void
}) {
  if (favourites.length === 0) return null

  return (
    <View style={styles.browserFavouritesGrid}>
      {favourites.map((favourite) => (
        <Pressable
          key={favourite.url}
          accessibilityRole='button'
          accessibilityLabel={`Open ${favourite.title}`}
          accessibilityHint='Press and hold to remove'
          style={styles.browserShortcut}
          onPress={() => onOpen(favourite.url)}
          onLongPress={() => onRemove(favourite)}
        >
          <View style={styles.browserShortcutIconFrame}>
            <View style={[styles.browserFavouriteIcon, { backgroundColor: palette.button }]}>
              {favourite.favicon
                ? (
                  <Image
                    source={{ uri: favourite.favicon }}
                    style={styles.browserFavouriteIconImage}
                  />
                  )
                : (
                  <Text style={[styles.browserFavouriteInitial, { color: palette.mutedText }]}>
                    {firstLetter(favourite.title)}
                  </Text>
                  )}
            </View>
          </View>
          <Text
            numberOfLines={2}
            style={[styles.browserShortcutTitle, { color: palette.text }]}
          >
            {favourite.title}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function firstLetter (title: string) {
  // Array.from, so a title starting with an emoji gives the whole emoji rather
  // than half a surrogate pair.
  return (Array.from(title.trim())[0] || '?').toUpperCase()
}
