import { useEffect, useRef, type FC } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import type { SvgProps } from 'react-native-svg'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

export type AppWelcomeContent = {
  icon: ImageSourcePropType
  title: string
  lead: string
  points: Array<{ id: string, Icon: FC<SvgProps>, title: string, body: string }>
  action: string
}

type AppWelcomeProps = {
  content: AppWelcomeContent
  isDark: boolean
  backgroundColor: string
  onDone: () => void
}

/**
 * The first time a P2P app opens: what it is in four lines, and one button.
 * The browser's own welcome in miniature, drawn inside the tab rather than
 * over it. The lines rise in one after another unless Reduce Motion is on.
 */
export function AppWelcome ({ content, isDark, backgroundColor, onDone }: AppWelcomeProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const appear = useRef([null, ...content.points].map(() => new Animated.Value(0))).current

  useEffect(() => {
    let active = true
    let animation: Animated.CompositeAnimation | null = null
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (!active) return
        if (reduceMotion) {
          appear.forEach((value) => value.setValue(1))
          return
        }
        animation = Animated.stagger(90, appear.map((value) => Animated.timing(value, {
          duration: 320,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true
        })))
        animation.start()
      })

    return () => {
      active = false
      animation?.stop()
    }
  }, [appear])

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }]
  })

  return (
    <View style={[styles.screen, { backgroundColor }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View style={[styles.header, rise(appear[0])]}>
          <Image source={content.icon} style={styles.icon} />
          <Text style={[styles.title, { color: palette.text }]}>{content.title}</Text>
          <Text style={[styles.lead, { color: palette.mutedText }]}>{content.lead}</Text>
        </Animated.View>

        <View style={styles.points}>
          {content.points.map(({ id, Icon, title, body }, index) => (
            <Animated.View key={id} style={[styles.point, rise(appear[index + 1])]}>
              <View style={[styles.pointIcon, { backgroundColor: palette.selectedBackground }]}>
                <Icon width={20} height={20} color={palette.selectedControl} />
              </View>
              <View style={styles.pointCopy}>
                <Text style={[styles.pointTitle, { color: palette.text }]}>{title}</Text>
                <Text style={[styles.pointBody, { color: palette.mutedText }]}>{body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole='button'
        onPress={onDone}
        style={({ pressed }) => [styles.start, pressed ? styles.startPressed : null]}
      >
        <Text style={styles.startText}>{content.action}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 28
  },
  header: { alignItems: 'center' },
  icon: { borderRadius: 18, height: 76, width: 76 },
  title: {
    fontSize: 26,
    fontWeight: '900',
    marginTop: 14,
    textAlign: 'center'
  },
  lead: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center'
  },
  points: { gap: 20, marginTop: 30 },
  point: { flexDirection: 'row', gap: 14 },
  pointIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  pointCopy: { flex: 1, gap: 4 },
  pointTitle: { fontSize: 15, fontWeight: '800' },
  pointBody: { fontSize: 13, lineHeight: 19 },
  start: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 14,
    justifyContent: 'center',
    marginBottom: 16,
    marginHorizontal: 26,
    minHeight: 52
  },
  startPressed: { opacity: 0.8 },
  startText: { color: '#ffffff', fontSize: 16, fontWeight: '800' }
})
