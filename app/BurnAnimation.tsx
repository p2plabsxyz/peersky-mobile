import { useEffect, useRef } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View
} from 'react-native'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { tapFeedback } from './haptics'

// The everyday bird, angry and on fire. scripts/generate-burn-bird.mjs makes it.
const BURN_BIRD = require('../assets/images/burn-bird.png')

const BIRD_SIZE = 168
const RISE_MS = 650
const HOLD_MS = 420
const FADE_MS = 450

// One flame in a 100 by 140 box: a round belly, a tip that leans and curls,
// and a smaller tongue breaking away on one side. The heart is its hot core.
const FLAME = 'M50 3 C55 23 71 35 81 53 C93 75 94 101 82 119 C72 133 61 138 50 138 C33 138 16 128 11 108 C5 86 15 67 27 55 C28 67 32 74 38 78 C35 60 40 46 45 33 C47 23 49 13 50 3 Z'
const FLAME_HEART = 'M52 58 C56 72 68 82 70 99 C72 117 62 131 50 131 C37 131 28 121 29 107 C30 95 36 89 41 83 C42 91 45 96 49 99 C47 85 48 71 52 58 Z'
const FLAME_WIDTH_PER_HEIGHT = 100 / 140

// Laid out for a 393 point wide phone and repeated across anything wider, so
// an iPad gets more flames rather than bigger ones. Each is [middle across
// the tile, height in points, leans the other way, which flicker it follows].
// Uneven on purpose: a row of equal flames reads as a pattern, not as fire.
const TILE_WIDTH = 393
type Flame = [middle: number, height: number, mirrored: boolean, beat: number]
const BACK_ROW: Flame[] = [
  [10, 150, false, 0], [70, 175, true, 1], [130, 140, false, 2], [195, 182, true, 0],
  [260, 150, false, 1], [322, 172, true, 2], [385, 148, false, 0]
]
const FRONT_ROW: Flame[] = [
  [0, 112, true, 1], [52, 130, false, 2], [108, 104, true, 0], [162, 136, false, 1],
  [218, 114, true, 2], [272, 128, false, 0], [330, 108, true, 1], [386, 122, false, 2]
]
// Where the fire's body starts once it is up, as a share of the screen.
const FIRE_TOP = 0.3
// Sparks: [across the tile, size, how far up it drifts, which beat carries it].
const SPARKS: Array<[number, number, number, number]> = [
  [30, 4, 190, 0], [88, 3, 150, 1], [140, 5, 230, 2], [204, 3, 170, 0],
  [250, 4, 210, 1], [300, 3, 160, 2], [352, 5, 200, 0], [176, 3, 260, 2]
]

/**
 * What burning the tabs looks like: a fire rises over the screen, its flames
 * flickering, the bird turns up in it in a temper, and when it clears the tabs
 * are gone.
 *
 * `onBurn` runs once the fire covers the screen, so the old tabs are never seen
 * going. With Reduce Motion on there is nothing to watch: it burns at once.
 */
export function BurnAnimation ({ onBurn, onDone }: { onBurn: () => void, onDone: () => void }) {
  const { height, width } = useWindowDimensions()
  const rise = useRef(new Animated.Value(0)).current
  const bird = useRef(new Animated.Value(0)).current
  const shake = useRef(new Animated.Value(0)).current
  const beats = useRef([0, 1, 2].map(() => new Animated.Value(0))).current
  const drifts = useRef([0, 1, 2].map(() => new Animated.Value(0))).current
  const fade = useRef(new Animated.Value(1)).current
  const callbacks = useRef({ onBurn, onDone })
  callbacks.current = { onBurn, onDone }

  useEffect(() => {
    let active = true
    let animation: Animated.CompositeAnimation | null = null
    // Three flickers of different lengths, so no two flames keep step.
    const flickering = Animated.parallel(beats.map((beat, index) => Animated.loop(Animated.sequence([
      Animated.timing(beat, { duration: 260 + index * 70, easing: Easing.inOut(Easing.quad), toValue: 1, useNativeDriver: true }),
      Animated.timing(beat, { duration: 300 + index * 60, easing: Easing.inOut(Easing.quad), toValue: 0, useNativeDriver: true })
    ]))))
    const drifting = Animated.parallel(drifts.map((drift, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 230),
      Animated.timing(drift, { duration: 900, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }),
      Animated.timing(drift, { duration: 0, toValue: 0, useNativeDriver: true })
    ]))))

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
        drifting.start()
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
            drifting.stop()
            if (active) callbacks.current.onDone()
          })
        })
      })

    return () => {
      active = false
      animation?.stop()
      flickering.stop()
      drifting.stop()
    }
  }, [beats, bird, drifts, fade, rise, shake])

  const fireTop = Math.round(height * FIRE_TOP)
  const tiles = Array.from({ length: Math.ceil(width / TILE_WIDTH) }, (_, index) => index * TILE_WIDTH)

  return (
    <Animated.View
      accessibilityLabel='Burning tabs'
      accessibilityLiveRegion='polite'
      style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.scorch, { opacity: rise }]} />
      <Animated.View
        style={[StyleSheet.absoluteFill, {
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }]
        }]}
      >
        {tiles.map((left) => BACK_ROW.map(([middle, size, mirrored, beat], index) => (
          <FlickeringFlame
            key={`back-${left}-${index}`}
            beat={beats[beat]}
            bottom={fireTop + size * 0.3}
            id={`back-${left}-${index}`}
            middle={left + middle}
            mirrored={mirrored}
            size={size}
            stops={['#ff6a1a', '#d9361a', '#d9361a']}
          />
        )))}
        <View style={[styles.body, { top: fireTop }]}>
          <Svg height='100%' preserveAspectRatio='none' viewBox='0 0 10 100' width='100%'>
            <Defs>
              <LinearGradient id='burn-body' x1='0' x2='0' y1='0' y2='1'>
                <Stop offset='0' stopColor='#ff8a24' />
                <Stop offset='0.16' stopColor='#ff5f17' />
                <Stop offset='0.55' stopColor='#c21d0e' />
                <Stop offset='1' stopColor='#4a0805' />
              </LinearGradient>
            </Defs>
            <Rect fill='url(#burn-body)' height='100' width='10' />
          </Svg>
        </View>
        {tiles.map((left) => SPARKS.map(([across, size, drift, beat], index) => (
          <Animated.View
            key={`spark-${left}-${index}`}
            style={[styles.spark, {
              borderRadius: size / 2,
              height: size,
              left: left + across,
              opacity: drifts[beat].interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
              top: fireTop + 40,
              transform: [{ translateY: drifts[beat].interpolate({ inputRange: [0, 1], outputRange: [0, -drift] }) }],
              width: size
            }]}
          />
        )))}
        {tiles.map((left) => FRONT_ROW.map(([middle, size, mirrored, beat], index) => (
          <FlickeringFlame
            key={`front-${left}-${index}`}
            beat={beats[beat]}
            bottom={fireTop + size * 0.42}
            heart
            id={`front-${left}-${index}`}
            middle={left + middle}
            mirrored={mirrored}
            size={size}
            stops={['#ffb43a', '#ff9a2c', '#ff8a24']}
          />
        )))}
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

type FlickeringFlameProps = {
  beat: Animated.Value
  bottom: number
  heart?: boolean
  id: string
  middle: number
  mirrored: boolean
  size: number
  stops: [string, string, string]
}

// Stretches and sways from its foot, the way a flame does, never as a block.
function FlickeringFlame ({ beat, bottom, heart = false, id, middle, mirrored, size, stops }: FlickeringFlameProps) {
  const flameWidth = size * FLAME_WIDTH_PER_HEIGHT
  const lean = mirrored ? -1 : 1
  return (
    <Animated.View
      style={[styles.flame, {
        height: size,
        left: middle - flameWidth / 2,
        top: bottom - size,
        transform: [
          { translateX: beat.interpolate({ inputRange: [0, 1], outputRange: [-1.5 * lean, 1.5 * lean] }) },
          { scaleY: beat.interpolate({ inputRange: [0, 1], outputRange: mirrored ? [1.07, 0.94] : [0.94, 1.07] }) },
          { scaleX: beat.interpolate({ inputRange: [0, 1], outputRange: [1.02, 0.97] }) }
        ],
        width: flameWidth
      }]}
    >
      <Svg height='100%' style={mirrored ? styles.mirrored : null} viewBox='0 0 100 140' width='100%'>
        <Defs>
          <LinearGradient id={`flame-${id}`} x1='0' x2='0' y1='0' y2='1'>
            <Stop offset='0' stopColor={stops[0]} />
            <Stop offset='0.7' stopColor={stops[1]} />
            <Stop offset='1' stopColor={stops[2]} />
          </LinearGradient>
          {heart && (
            <LinearGradient id={`heart-${id}`} x1='0' x2='0' y1='0' y2='1'>
              <Stop offset='0' stopColor='#fff3b0' />
              <Stop offset='0.55' stopColor='#ffd447' />
              <Stop offset='1' stopColor='#ff9a2c' />
            </LinearGradient>
          )}
        </Defs>
        <Path d={FLAME} fill={`url(#flame-${id})`} />
        {heart && <Path d={FLAME_HEART} fill={`url(#heart-${id})`} />}
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000 },
  scorch: { backgroundColor: '#1c0703' },
  body: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  flame: { position: 'absolute', transformOrigin: 'bottom' },
  mirrored: { transform: [{ scaleX: -1 }] },
  spark: { backgroundColor: '#ffd36b', position: 'absolute' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  bird: { height: BIRD_SIZE, width: BIRD_SIZE }
})
