/**
 * Every path that is not "/" renders the browser, which is the only screen.
 *
 * +native-intent.ts keeps system links away from the router, so this only
 * catches a path that gets here some other way. Answering it with a redirect
 * back to "/" once put the router in a loop it could not settle, until React
 * gave up with "Maximum update depth exceeded". Rendering the browser here
 * means there is no navigation to loop over.
 *
 * Links still reach the browser: incoming-links.ts listens outside the screen
 * and holds a link until the browser says it loaded it.
 */
export { default } from './index'
