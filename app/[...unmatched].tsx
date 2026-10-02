/**
 * Every path that is not "/" renders the browser, the only screen.
 * +native-intent.ts keeps system links away from the router, so this only
 * catches stray paths. A redirect to "/" here looped until React threw
 * "Maximum update depth exceeded". Links still arrive via incoming-links.ts.
 */
export { default } from './index'
