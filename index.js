// The app, and the task Android runs to start PeerChat when PeerSky has no
// screen (app/peerchat/background-task.ts). The service starts the task by
// this name (plugins/templates/PeerChatBackgroundService.kt.template).
import 'expo-router/entry'
import { AppRegistry } from 'react-native'

AppRegistry.registerHeadlessTask('PeerChatBackground', () => require('./app/peerchat/background-task').runPeerChatBackgroundTask)
