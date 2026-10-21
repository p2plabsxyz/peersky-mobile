import { useMemo } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { t } from '../i18n/i18n.mjs'
import { drawQrCode } from './qr-elf.mjs'

type QrCodeViewProps = {
  value: string
  size?: number
}

type QrLayer = { fill: string, d: string }

// Drawn by qr-creator, as the desktop's qr-code elf draws its codes
// (qr-elf.mjs): black on white, rounded dots.
export function QrCodeView ({ value, size = 220 }: QrCodeViewProps) {
  const { code, error } = useMemo(() => {
    if (!value) return { code: null, error: null }
    try {
      return { code: drawQrCode(value, { fg: '#000000', bg: '#ffffff' }) as { size: number, layers: QrLayer[] }, error: null }
    } catch (err) {
      return { code: null, error: err instanceof Error ? err.message : String(err) }
    }
  }, [value])

  if (error) {
    return (
      <View style={[styles.placeholder, { width: size, height: size, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: 'red', textAlign: 'center', padding: 8 }}>{t('QR Error: {error}', { error })}</Text>
      </View>
    )
  }

  if (!code) {
    return <View style={[styles.placeholder, { width: size, height: size }]} />
  }

  return (
    <View style={[styles.container, { width: size + 16, height: size + 16 }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${code.size} ${code.size}`}>
        {code.layers.map((layer, index) => <Path key={index} d={layer.d} fill={layer.fill} />)}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 12
  },
  placeholder: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    alignSelf: 'center',
    marginVertical: 12
  }
})
