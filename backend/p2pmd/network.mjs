import http from 'bare-http1'
import { P2PMD_LOOPBACK_HOST } from './constants.mjs'

export { P2PMD_LOOPBACK_HOST }

export async function getAvailableLoopbackPort () {
  const reservation = http.createServer((req, res) => {
    res.statusCode = 503
    res.end()
  })

  const address = await new Promise((resolve, reject) => {
    const onError = (error) => {
      reservation.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      reservation.off('error', onError)
      resolve(reservation.address())
    }

    reservation.once('error', onError)
    reservation.once('listening', onListening)
    reservation.listen(0, P2PMD_LOOPBACK_HOST)
  })

  // The reservation is released before Holesail binds to the returned port.
  // This leaves a small race window, but loopback port contention is rare on mobile.
  await new Promise((resolve, reject) => {
    reservation.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  const port = typeof address === 'object' && address ? address.port : null
  if (!Number.isInteger(port) || port < 1) {
    throw new Error('Unable to allocate a local P2PMD client port.')
  }

  return port
}
