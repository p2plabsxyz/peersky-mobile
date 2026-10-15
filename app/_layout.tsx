// First, so the first screen is already in the language picked.
import './i18n/setup'
import { Slot } from 'expo-router'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'

export default function RootLayout() {
  // Without initialMetrics the provider reports zero insets until its native
  // view has measured, so anything mounting on that first frame paints under
  // the status bar. On a notched or Dynamic Island phone the Tabs header landed
  // behind the island. initialWindowMetrics supplies the real insets
  // synchronously, so the first frame is already correct.
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Slot />
    </SafeAreaProvider>
  )
}
