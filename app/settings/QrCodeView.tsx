import { useMemo } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { createQrMatrix } from './qrcode-matrix.mjs'

type QrCodeViewProps = {
  value: string
  size?: number
}

export function QrCodeView ({ value, size = 220 }: QrCodeViewProps) {
  const { matrix, error } = useMemo(() => {
    if (!value) return { matrix: [], error: null }
    try {
      return { matrix: createQrMatrix(value, 'M'), error: null }
    } catch (err) {
      return { matrix: [], error: err instanceof Error ? err.message : String(err) }
    }
  }, [value])

  if (error) {
    return (
      <View style={[styles.placeholder, { width: size, height: size, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: 'red', textAlign: 'center', padding: 8 }}>QR Error: {error}</Text>
      </View>
    )
  }

  if (!matrix || matrix.length === 0) {
    return <View style={[styles.placeholder, { width: size, height: size }]} />
  }

  const moduleCount = matrix.length
  const cellSize = Math.floor(size / moduleCount)
  const actualSize = cellSize * moduleCount

  let path = ''
  for (let rIndex = 0; rIndex < moduleCount; rIndex++) {
    for (let cIndex = 0; cIndex < moduleCount; cIndex++) {
      if (matrix[rIndex][cIndex]) {
        path += `M${cIndex * cellSize},${rIndex * cellSize}h${cellSize}v${cellSize}h-${cellSize}z `
      }
    }
  }

  return (
    <View style={[styles.container, { width: actualSize + 16, height: actualSize + 16 }]}>
      <Svg width={actualSize} height={actualSize} viewBox={`0 0 ${actualSize} ${actualSize}`}>
        <Path d={path} fill="#000000" />
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
