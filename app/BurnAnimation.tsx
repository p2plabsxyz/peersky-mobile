import { useEffect, useRef } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View
} from 'react-native'
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { tapFeedback } from './haptics'

// The everyday bird, angry and on fire. scripts/generate-burn-bird.mjs makes it.
const BURN_BIRD = require('../assets/images/burn-bird.png')

const BIRD_SIZE = 168
const RISE_MS = 620
const HOLD_MS = 240
const FADE_MS = 420

// Two walls of flame, drawn in a 100 by 140 box and stretched to the screen.
// Each tongue is [from x, peak x, peak y, to x, foot y]. They are uneven on
// purpose: a row of equal peaks reads as a pattern, not as fire.
const FRONT_FLAMES = flamePath([
  [0, 8, 12, 16, 44], [16, 25, 2, 34, 40], [34, 41, 18, 49, 44],
  [49, 58, 0, 66, 41], [66, 74, 14, 82, 45], [82, 91, 4, 100, 42]
])
const BACK_FLAMES = flamePath([
  [0, 5, 4, 12, 36], [12, 20, 16, 28, 34], [28, 35, 0, 43, 33], [43, 51, 12, 59, 35],
  [59, 67, 2, 75, 33], [75, 83, 14, 91, 35], [91, 96, 6, 100, 30]
])

// Round at the foot and curling to a point, so it licks rather than spikes.
function flamePath (tongues: Array<[number, number, number, number, number]>) {
  let path = `M0 ${tongues[0][4]}`
  let footY = tongues[0][4]
  for (const [fromX, peakX, peakY, toX, toY] of tongues) {
    path += ` C${fromX + 2.5} ${footY - 12} ${peakX - 3.5} ${peakY + 14} ${peakX} ${peakY}`
    path += ` C${peakX + 1.5} ${peakY + 16} ${toX - 2.5} ${toY - 10} ${toX} ${toY}`
    footY = toY
  }
  return `${path} L100 140 L0 140 Z`
}

/**
 * What burning the tabs looks like: a wall of flame rises over the screen, the
 * bird turns up in it in a temper, and when it clears the tabs are gone.
 *
 * `onBurn` runs once the flames cover the screen, so the old tabs are never
 * seen going. With Reduce Motion on there is nothing to watch: it burns at once.
 */
export function BurnAnimation ({ onBurn, onDone }: { onBurn: () => void, onDone: () => void }) {
  const { height, width } = useWindowDimensions()
  const rise = useRef(new Animated.Value(0)).current
  const bird = useRef(new Animated.Value(0)).current
  const shake = useRef(new Animated.Value(0)).current
  const flicker = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current
  const callbacks = useRef({ onBurn, onDone })
  callbacks.current = { onBurn, onDone }

  useEffect(() => {
    let active = true
    let animation: Animated.CompositeAnimation | null = null
    const flickering = Animated.loop(Animated.sequence([
      Animated.timing(flicker, { duration: 140, easing: Easing.inOut(Easing.quad), toValue: 1, useNativeDriver: true }),
      Animated.timing(flicker, { duration: 160, easing: Easing.inOut(Easing.quad), toValue: 0, useNativeDriver: true })
    ]))

    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (!active) return
        if (reduceMotion) {
          callbacks.current.onBurn()
          callbacks.current.onDone()
          return
        }

        flickering.start()
        animation = Animated.sequence([
          Animated.parallel([
            Animated.timing(rise, { duration: RISE_MS, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
            Animated.sequence([
              Animated.delay(RISE_MS * 0.35),
              Animated.spring(bird, { friction: 5, tension: 120, toValue: 1, useNativeDriver: true })
            ]),
            Animated.sequence([
              Animated.delay(RISE_MS * 0.45),
              Animated.timing(shake, { duration: 70, toValue: 1, useNativeDriver: true }),
              Animated.timing(shake, { duration: 70, toValue: -1, useNativeDriver: true }),
              Animated.timing(shake, { duration: 70, toValue: 0.6, useNativeDriver: true }),
              Animated.timing(shake, { duration: 70, toValue: 0, useNativeDriver: true })
            ])
          ]),
          Animated.delay(HOLD_MS)
        ])
        setTimeout(() => { if (active) tapFeedback('heavy') }, RISE_MS * 0.45)
        animation.start(({ finished }) => {
          if (!active) return
          callbacks.current.onBurn()
          if (!finished) {
            callbacks.current.onDone()
            return
          }
          animation = Animated.timing(fade, { duration: FADE_MS, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver: true })
          animation.start(() => {
            flickering.stop()
            if (active) callbacks.current.onDone()
          })
        })
      })

    return () => {
      active = false
      animation?.stop()
      flickering.stop()
    }
  }, [bird, fade, flicker, rise, shake])

  // Risen, the tongues lick at the top of the screen over embers dark enough
  // that nothing of the old tabs shows between them.
  const wallHeight = height * 1.25
  const climb = (start: number, end: number) => rise.interpolate({ inputRange: [0, 1], outputRange: [start, end] })

  return (
    <Animated.View
      accessibilityLabel='Burning tabs'
      accessibilityLiveRegion='polite'
      style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.scorch, { opacity: rise }]} />
      <Animated.View
        style={[styles.wall, {
          height: wallHeight,
          transform: [
            { translateY: climb(height, -height * 0.1) },
            { scaleY: flicker.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }
          ],
          width
        }]}
      >
        <Flames id='back' path={BACK_FLAMES} stops={['#ffb347', '#ff6a1a', '#b5170e', '#4a0905']} />
      </Animated.View>
      <Animated.View
        style={[styles.wall, {
          height: wallHeight,
          transform: [
            { translateY: climb(height * 1.08, -height * 0.02) },
            { scaleY: flicker.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1] }) }
          ],
          width
        }]}
      >
        <Flames id='front' path={FRONT_FLAMES} stops={['#fff1a8', '#ffc533', '#f0551b', '#8f1409']} />
      </Animated.View>
      <View pointerEvents='none' style={[StyleSheet.absoluteFill, styles.centre]}>
        <Animated.Image
          source={BURN_BIRD}
          style={[styles.bird, {
            opacity: bird.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [
              { scale: Animated.multiply(bird.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), fade.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] })) },
              { rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] }) }
            ]
          }]}
        />
      </View>
    </Animated.View>
  )
}

function Flames ({ id, path, stops }: { id: string, path: string, stops: [string, string, string, string] }) {
  return (
    <Svg height='100%' preserveAspectRatio='none' viewBox='0 0 100 140' width='100%'>
      <Defs>
        <LinearGradient id={`flame-${id}`} x1='0' x2='0' y1='0' y2='1'>
          <Stop offset='0' stopColor={stops[0]} />
          <Stop offset='0.16' stopColor={stops[1]} />
          <Stop offset='0.42' stopColor={stops[2]} />
          <Stop offset='0.9' stopColor={stops[3]} />
        </LinearGradient>
      </Defs>
      <Path d={path} fill={`url(#flame-${id})`} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000 },
  scorch: { backgroundColor: '#1c0703' },
  wall: { left: 0, position: 'absolute', top: 0 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  bird: { height: BIRD_SIZE, width: BIRD_SIZE }
})
