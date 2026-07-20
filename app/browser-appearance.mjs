import { BROWSER_HOME_URL } from './browser-shell.mjs'

export const BROWSER_PALETTES = {
  dark: {
    accent: '#4b91ed',
    address: '#252a35',
    border: '#394152',
    button: '#2a3140',
    mutedText: '#aeb8ca',
    selectedBackground: '#263d5e',
    selectedControl: '#8fc1ff',
    shell: '#171a22',
    surface: '#20242e',
    text: '#f3f6fb'
  },
  light: {
    accent: '#1f6fd1',
    address: '#ffffff',
    border: '#dbe6f6',
    button: '#e8f0fb',
    mutedText: '#687086',
    selectedBackground: '#edf5ff',
    selectedControl: '#1f6fd1',
    shell: '#f5f8ff',
    surface: '#ffffff',
    text: '#1f2a44'
  }
}

export function getBrowserPalette (isDark) {
  return isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
}

export function resolveBrowserDarkMode (theme, systemColorScheme) {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return systemColorScheme === 'dark'
}

export function formatBrowserAddress (address, showFullAddress) {
  const value = String(address || '')
  if (showFullAddress || !value || value === BROWSER_HOME_URL) return value

  try {
    const parsed = new URL(value)
    if (!parsed.host) return value
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return value
  }
}
