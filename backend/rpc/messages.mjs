import b4a from 'b4a'

export function parseJsonMessage (data) {
  if (!data || data.length === 0) return {}
  return JSON.parse(b4a.toString(data))
}

export function replyJson (req, payload) {
  req.reply(b4a.from(JSON.stringify(payload)))
}
