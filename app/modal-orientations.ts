import type { ModalProps } from 'react-native'

/**
 * A <Modal> on iOS supports portrait and nothing else unless it is told
 * otherwise, so opening a sheet while the phone is on its side rotated the
 * whole app upright. Every modal in here gets this, because the app itself
 * allows every orientation and its sheets have to agree.
 */
export const MODAL_ORIENTATIONS: ModalProps['supportedOrientations'] = [
  'portrait',
  'portrait-upside-down',
  'landscape'
]
