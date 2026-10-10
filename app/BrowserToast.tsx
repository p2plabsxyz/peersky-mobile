import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native'

export type BrowserToastMessage = {
  // A new one each time, so the same words twice still show twice.
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

// Long enough to read it and reach Undo, which is what a toast with an action
// is for. One that only says something can go sooner.
const TOAST_VISIBLE_MS = 3000
const TOAST_WITH_ACTION_VISIBLE_MS = 5000

/**
 * A line near the bottom saying what just happened, with at most one thing to
 * do about it: "Tab closed" and Undo. It goes away by itself. The browser said
 * these things in a status line nobody could see outside the built-in apps.
 */
export function BrowserToast ({
  bottom,
  isDark,
  toast,
  onHide
}: {
  bottom: number
  isDark: boolean
  toast: BrowserToastMessage | null
  onHide: () => void
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const onHideRef = useRef(onHide)
  onHideRef.current = onHide

  useEffect(() => {
    if (!toast) return
    opacity.setValue(0)
    Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }).start()
    AccessibilityInfo.announceForAccessibility(toast.message)
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onHideRef.current()
      })
    }, toast.onAction ? TOAST_WITH_ACTION_VISIBLE_MS : TOAST_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [opacity, toast])

  if (!toast) return null

  return (
    <Animated.View pointerEvents='box-none' style={[styles.wrap, { bottom, opacity }]}>
      <View style={[styles.toast, isDark ? styles.toastDark : null]}>
        <Text numberOfLines={2} style={styles.message}>{toast.message}</Text>
        {toast.actionLabel && toast.onAction
          ? (
            <Pressable
              accessibilityRole='button'
              hitSlop={10}
              onPress={() => {
                toast.onAction?.()
                onHideRef.current()
              }}
            >
              <Text style={styles.action}>{toast.actionLabel}</Text>
            </Pressable>
            )
          : null}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    left: 16,
    position: 'absolute',
    right: 16,
    zIndex: 40
  },
  toast: {
    alignItems: 'center',
    backgroundColor: '#23262e',
    borderRadius: 12,
    elevation: 8,
    flexDirection: 'row',
    gap: 16,
    maxWidth: 520,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    width: '100%'
  },
  toastDark: {
    backgroundColor: '#3b404c'
  },
  message: {
    color: '#ffffff',
    flex: 1,
    fontSize: 14,
    fontWeight: '600'
  },
  action: {
    color: '#8fc0ff',
    fontSize: 14,
    fontWeight: '800'
  }
})
