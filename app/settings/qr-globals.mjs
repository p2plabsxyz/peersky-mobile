// qr-creator puts itself on `self` as it loads, as a browser script does.
// React Native defines `self`; Node, where the tests run, does not.
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis
