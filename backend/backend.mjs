import './bare-globals.mjs'

import('./main.mjs').catch((error) => {
  console.error('[backend] Failed to start:', error)
})
