import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Whether the keyboard is on screen.
 *
 * The navigation bar is worth a row of the screen when you are reading and
 * worth nothing at all when you are typing, and on a short screen it is the
 * difference between seeing the field you are filling in and not.
 */
export function useKeyboardVisible () {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // iOS reports the frame before the keyboard animates in, so the bar leaves
    // with it rather than after it. Android only has the did events.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const shown = Keyboard.addListener(showEvent, () => setIsVisible(true))
    const hidden = Keyboard.addListener(hideEvent, () => setIsVisible(false))

    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  return isVisible
}
