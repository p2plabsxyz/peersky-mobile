import { BROWSER_HOME_URL } from './browser-shell.mjs'

export const BROWSER_PALETTES = {
  dark: {
    accent: '#3b82f6',
    address: '#18181b',
    border: '#6b7280',
    button: '#27272a',
    mutedText: '#9ca3af',
    selectedBackground: '#3f3f46',
    selectedControl: '#e5e7eb',
    shell: '#18181b',
    surface: '#27272a',
    text: '#ffffff'
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
  if (
    showFullAddress ||
    !value ||
    value === BROWSER_HOME_URL ||
    value.toLowerCase().startsWith('peersky://')
  ) return value

  try {
    const parsed = new URL(value)
    if (!parsed.host) return value
    return parsed.host
  } catch {
    return value
  }
}
