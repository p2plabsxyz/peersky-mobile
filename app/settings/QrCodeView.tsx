import { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { createQrMatrix } from './qrcode-matrix.mjs'

type QrCodeViewProps = {
  value: string
  size?: number
}

export function QrCodeView ({ value, size = 220 }: QrCodeViewProps) {
  const matrix = useMemo(() => {
    if (!value) return []
    try {
      return createQrMatrix(value, 'M')
    } catch {
      return []
    }
  }, [value])

  if (!matrix || matrix.length === 0) {
    return <View style={[styles.placeholder, { width: size, height: size }]} />
  }

  const moduleCount = matrix.length
  const cellSize = Math.floor(size / moduleCount)
  const actualSize = cellSize * moduleCount

  return (
    <View style={[styles.container, { width: actualSize + 16, height: actualSize + 16 }]}>
      <View style={{ width: actualSize, height: actualSize }}>
        {matrix.map((row: boolean[], rIndex: number) => (
          <View key={`r-${rIndex}`} style={{ flexDirection: 'row', height: cellSize }}>
            {row.map((isDark: boolean, cIndex: number) => (
              <View
                key={`c-${rIndex}-${cIndex}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: isDark ? '#000000' : '#ffffff'
                }}
              />
            ))}
          </View>
        ))}
      </View>
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
