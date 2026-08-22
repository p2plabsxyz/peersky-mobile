export async function connectWithPreferredLoopbackPort ({
  connect,
  getAvailablePort,
  key,
  host,
  udp,
  log
}) {
  try {
    // Without an explicit port, Holesail mirrors the host's DHT-advertised port.
    const result = await connect({
      key,
      host,
      preferRemotePort: true,
      udp,
      log
    })
    if (result?.ok !== false) return result
  } catch {
    // Retry below with an explicitly reserved local port.
  }

  const port = await getAvailablePort()
  return connect({ key, host, port, udp, log })
}
