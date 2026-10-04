// How far a page keeps gliding after a swipe. react-native-webview gives iOS a
// rate of 0 when this is left unset, so a swipe stopped dead the moment the
// finger lifted.
//
// This is Safari's 'normal' rate, written as the number. iOS turns the string
// into this same number in JavaScript, but Android hands the prop straight to
// a native view that reads it as a double, and the string crashed the app as
// soon as PeerTunes, a note or the media viewer opened.
export const WEBVIEW_DECELERATION_RATE = 0.998
