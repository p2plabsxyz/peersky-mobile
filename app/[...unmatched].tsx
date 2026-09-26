/**
 * Every path that is not "/" renders the browser, which is the only screen.
 *
 * A deep link like peersky://p2p/peerchat/#room=... is not one of expo-router's
 * routes, and neither is the dev client's own launch URL. Answering those with
 * a redirect back to "/" put the router in a loop it could not settle: it kept
 * resolving to the unmatched route, which redirected again, until React gave up
 * with "Maximum update depth exceeded". Rendering the browser here instead means
 * there is no navigation to loop over.
 *
 * The address still reaches the browser: incoming-links.ts listens outside the
 * screen and holds a link until the browser says it loaded it.
 */
export { default } from './index'
