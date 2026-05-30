declare module '*.mjs' {
  const source: string
  export default source
}

declare module 'bare-rpc' {
  import type { Duplex } from 'streamx'

  type RPCData = string | Uint8Array | null

  interface RPCIncomingRequest {
    readonly command: number
    readonly data: RPCData
    reply(data?: RPCData): void
  }

  interface RPCOutgoingRequest {
    send(data?: RPCData): void
    reply(encoding?: string): Promise<RPCData>
  }

  class RPC {
    constructor(
      stream: Duplex,
      onrequest: (req: RPCIncomingRequest) => void | Promise<void>
    )

    request(command: number): RPCOutgoingRequest
  }

  namespace RPC {
    export {
      type RPCIncomingRequest as IncomingRequest,
      type RPCOutgoingRequest as OutgoingRequest
    }
  }

  export = RPC
}
