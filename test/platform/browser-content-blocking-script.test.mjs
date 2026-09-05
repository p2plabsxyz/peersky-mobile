import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

import { createBrowserContentBlockingScript } from '../../app/privacy/browserContentBlockingScript.mjs'

test('blocked XHRs complete with browser-compatible failure events', async () => {
  const events = []

  class FakeXMLHttpRequest {
    static DONE = 4

    open (method, url) {
      this.method = method
      this.url = url
      this.readyState = 1
    }

    send () {
      this.wasSent = true
    }

    dispatchEvent (event) {
      events.push(event.type)
    }
  }

  class FakeEvent {
    constructor (type) {
      this.type = type
    }
  }

  const window = {
    XMLHttpRequest: FakeXMLHttpRequest,
    PeerSkyContentBlocker: {
      shouldBlock: () => true
    },
    fetch: () => Promise.resolve()
  }
  const context = {
    document: {
      baseURI: 'https://example.com/'
    },
    Event: FakeEvent,
    location: {
      href: 'https://example.com/'
    },
    ProgressEvent: FakeEvent,
    setTimeout,
    URL,
    window
  }

  runInNewContext(createBrowserContentBlockingScript({
    bridgeToken: 'a'.repeat(32),
    enabled: true
  }), context)

  const request = new FakeXMLHttpRequest()
  request.open('GET', 'https://ads.example/banner.js')
  request.send()
  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(request.readyState, FakeXMLHttpRequest.DONE)
  assert.equal(request.wasSent, undefined)
  assert.deepEqual(events, ['readystatechange', 'error', 'loadend'])
})
