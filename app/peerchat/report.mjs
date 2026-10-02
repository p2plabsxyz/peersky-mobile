// There is no server to receive a report, so it goes to the maintainers by
// email. The room is named by a hash of its key, never the key itself: the key
// lets whoever holds it into the room and all of its history.

export const PEERCHAT_REPORT_EMAIL = 'contact@p2plabs.xyz'

const MAX_QUOTED_MESSAGE = 1000

/**
 * @param {object} report
 * @param {{ id: string, username?: string }} report.member
 * @param {string} [report.roomName]
 * @param {string} [report.roomId] First 16 hex characters of the SHA-256 of the room key.
 * @param {{ text: string, ts?: number } | null} [report.message] The message being reported, if any.
 * @param {Date} [report.now]
 */
export function buildPeerChatReport ({ member, roomName = '', roomId = '', message = null, now = new Date() }) {
  const name = member.username || member.id
  const lines = [
    `Reported user: ${name}`,
    `Peer ID: ${member.id}`,
    `Room: ${roomName || 'unknown'}`,
    `Room ID: ${roomId || 'unknown'}`
  ]
  if (message) {
    const text = String(message.text || '')
    const sentAt = Number.isFinite(message.ts) ? new Date(message.ts).toISOString() : 'unknown'
    lines.push(
      `Message sent at: ${sentAt}`,
      'Message:',
      text.length > MAX_QUOTED_MESSAGE ? `${text.slice(0, MAX_QUOTED_MESSAGE)}…` : text
    )
  }
  lines.push(
    `Reported at: ${now.toISOString()}`,
    '',
    'What happened?',
    '',
    '',
    'Please describe the behaviour above. PeerChat is peer to peer, so nobody',
    'can remove content for you, but blocking stops their direct messages.'
  )

  const subject = `PeerChat report: ${name}`
  const body = lines.join('\n')
  return {
    subject,
    body,
    url: `mailto:${PEERCHAT_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
}
