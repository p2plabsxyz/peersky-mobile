import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

// Most waits are over before a line about them could be read, so the page
// stays blank, as a page does before it draws, and says why only past this.
const SAY_WHY_AFTER_MS = 2000

/**
 * A tab's page while it waits to load: blank, in the browser's own colours,
 * where a white screen with a line of text flashed at every start. A long wait,
 * such as tracker rules being built after a list update, still says why.
 */
export function BrowserWaitPage ({
  label,
  palette
}: {
  label: string
  palette: { accent: string, mutedText: string, surface: string }
}) {
  const [sayWhy, setSayWhy] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSayWhy(true), SAY_WHY_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <View style={[styles.page, { backgroundColor: palette.surface }]}>
      {sayWhy && (
        <>
          <ActivityIndicator size='small' color={palette.accent} />
          <Text style={[styles.label, { color: palette.mutedText }]}>{label}</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center'
  },
  label: {
    fontSize: 14
  }
})
