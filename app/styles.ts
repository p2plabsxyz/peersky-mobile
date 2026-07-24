import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  browserShell: {
    backgroundColor: '#f5f8ff',
    flex: 1
  },
  browserShellContent: {
    flex: 1
  },
  browserToolbar: {
    alignItems: 'center',
    backgroundColor: '#f5f8ff',
    borderBottomColor: '#dbe6f6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16
  },
  browserNavButton: {
    alignItems: 'center',
    backgroundColor: '#e8f0fb',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 34
  },
  browserNavButtonDisabled: {
    opacity: 0.35
  },
  browserNavButtonText: {
    color: '#1f2a44',
    fontSize: 18,
    fontWeight: '800'
  },
  browserAddress: {
    backgroundColor: '#ffffff',
    borderColor: '#d2dff1',
    borderRadius: 18,
    borderWidth: 1,
    color: '#151821',
    flex: 1,
    fontSize: 15,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  browserActionButton: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 9,
    height: 38,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10
  },
  browserActionButtonText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800'
  },
  browserShareButton: {
    alignItems: 'center',
    backgroundColor: '#e8f0fb',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  browserTabCountButton: {
    alignItems: 'center',
    backgroundColor: '#e8f0fb',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  browserTabCountIcon: {
    alignItems: 'center',
    borderColor: '#24324f',
    borderRadius: 4,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  browserTabCountText: {
    color: '#24324f',
    fontSize: 11,
    fontWeight: '900'
  },
  browserTabsScreen: {
    backgroundColor: '#eef4fc',
    flex: 1
  },
  browserTabsHeader: {
    alignItems: 'center',
    borderBottomColor: '#d2dff1',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18
  },
  browserTabsTitle: {
    color: '#151821',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30
  },
  browserTabsSubtitle: {
    color: '#68738a',
    fontSize: 13,
    marginTop: 2
  },
  browserTabsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    padding: 16
  },
  browserTabCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d4dfef',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 190,
    overflow: 'hidden',
    position: 'relative',
    width: '47.8%'
  },
  browserTabCardActive: {
    borderColor: '#2f80ed',
    borderWidth: 2
  },
  browserTabCardBody: {
    flex: 1,
    padding: 10
  },
  browserTabCardPreview: {
    alignItems: 'center',
    backgroundColor: '#f5f8ff',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 116,
    padding: 12
  },
  browserTabCardPreviewText: {
    color: '#52617a',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center'
  },
  browserTabCardTitle: {
    color: '#202b43',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 9,
    paddingRight: 26
  },
  browserTabCardUrl: {
    color: '#7d879a',
    fontSize: 10,
    marginTop: 3
  },
  browserTabCardClose: {
    alignItems: 'center',
    backgroundColor: '#e7eef8',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 26
  },
  browserTabCardCloseText: {
    color: '#33415e',
    fontSize: 12,
    fontWeight: '900'
  },
  browserTabsNewButton: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  browserTabsNewButtonDisabled: {
    opacity: 0.4
  },
  browserTabsNewButtonText: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '500',
    lineHeight: 28
  },
  browserChip: {
    backgroundColor: '#e8f0fb',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7
  },
  browserChipText: {
    color: '#24324f',
    fontSize: 12,
    fontWeight: '800'
  },
  browserHome: {
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 36
  },
  browserHomeTitle: {
    color: '#121722',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0
  },
  browserHomeSubtitle: {
    color: '#596276',
    fontSize: 15,
    lineHeight: 22
  },
  browserShortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 28
  },
  browserShortcut: {
    alignItems: 'center',
    gap: 9,
    width: '25%'
  },
  browserShortcutIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 64,
    justifyContent: 'center',
    width: 64
  },
  browserShortcutIconAkhilesh: {
    backgroundColor: '#4669a7'
  },
  browserShortcutIconPeerSky: {
    backgroundColor: '#73e4d4'
  },
  browserShortcutIconP2pmd: {
    backgroundColor: '#2f80ed'
  },
  browserShortcutIconHolesail: {
    backgroundColor: '#f35f73'
  },
  browserShortcutIconHyper: {
    backgroundColor: '#273b65'
  },
  browserShortcutIconText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900'
  },
  browserShortcutTitle: {
    color: '#1d2943',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center'
  },
  browserShortcutUrl: {
    color: '#667085',
    fontSize: 12
  },
  browserContent: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative'
  },
  browserContentPage: {
    flex: 1
  },
  browserWebViewLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1
  },
  browserWebViewLayerHidden: {
    display: 'none',
    zIndex: 0
  },
  browserWebView: {
    backgroundColor: '#ffffff',
    flex: 1
  },
  browserRestorePage: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flex: 1,
    gap: 10,
    justifyContent: 'center'
  },
  browserRestoreText: {
    color: '#596276',
    fontSize: 14
  },
  browserLoader: {
    position: 'absolute',
    right: 12,
    top: 98
  },
  p2pmdWorkspace: {
    backgroundColor: '#1f2027',
    flex: 1
  },
  p2pmdWorkspaceHeader: {
    alignItems: 'center',
    backgroundColor: '#24262f',
    borderBottomColor: '#3a3d49',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  p2pmdWorkspaceTitle: {
    color: '#f1f2f7',
    fontSize: 18,
    fontWeight: '800'
  },
  p2pmdWorkspaceParticipants: {
    backgroundColor: '#30364a',
    borderRadius: 999,
    color: '#cdd6ff',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  p2pmdWorkspaceRole: {
    backgroundColor: '#3a3020',
    borderRadius: 999,
    color: '#ffd27a',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: 'uppercase'
  },
  p2pmdWorkspaceRoleHost: {
    backgroundColor: '#1d513d',
    color: '#c6f6df'
  },
  p2pmdPreviewButton: {
    backgroundColor: '#2f80ed',
    borderRadius: 12,
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  p2pmdPreviewButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7
  },
  p2pmdPreviewButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800'
  },
  p2pmdEyeIcon: {
    alignItems: 'center',
    borderColor: '#fff',
    borderRadius: 3,
    borderWidth: 2,
    height: 14,
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    width: 14
  },
  p2pmdEyeIconDot: {
    backgroundColor: '#fff',
    borderRadius: 2,
    height: 4,
    transform: [{ rotate: '-45deg' }],
    width: 4
  },
  p2pmdPencilIcon: {
    height: 17,
    justifyContent: 'center',
    width: 17
  },
  p2pmdPencilBody: {
    backgroundColor: '#fff',
    borderRadius: 2,
    height: 3,
    left: 1,
    transform: [{ rotate: '-35deg' }],
    width: 14
  },
  p2pmdPencilTip: {
    backgroundColor: '#fff',
    height: 4,
    position: 'absolute',
    right: 1,
    top: 3,
    transform: [{ rotate: '-35deg' }],
    width: 3
  },
  p2pmdWorkspaceMeta: {
    alignItems: 'center',
    backgroundColor: '#202128',
    borderBottomColor: '#3a3d49',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  p2pmdRoomIdentity: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  p2pmdWorkspaceKeyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0
  },
  p2pmdWorkspaceKeyLabel: {
    backgroundColor: '#30364a',
    borderRadius: 6,
    color: '#cdd6ff',
    fontSize: 9,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
    textTransform: 'uppercase'
  },
  p2pmdWorkspaceKey: {
    color: '#59a6ff',
    flex: 1,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700'
  },
  p2pmdWorkspaceUrl: {
    color: '#a2a8bb',
    fontFamily: 'monospace',
    fontSize: 11,
    minWidth: 0
  },
  p2pmdPublishedUrlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minWidth: 0
  },
  p2pmdPublishedUrlLabel: {
    color: '#cdd6ff',
    fontSize: 10,
    fontWeight: '800'
  },
  p2pmdPublishedUrl: {
    color: '#59a6ff',
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 10,
    minWidth: 0
  },
  p2pmdWorkspaceSyncStatus: {
    color: '#cdd6ff',
    fontSize: 11,
    fontWeight: '700'
  },
  p2pmdMetaButton: {
    backgroundColor: '#30364a',
    borderColor: '#4c5675',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  p2pmdMetaButtonDanger: {
    backgroundColor: '#4a2730',
    borderColor: '#7c3b48'
  },
  p2pmdMetaButtonText: {
    color: '#f1f2f7',
    fontSize: 12,
    fontWeight: '800'
  },
  p2pmdWorkspaceWebView: {
    backgroundColor: '#202128',
    flex: 1
  },
  p2pmdWorkspaceLoader: {
    bottom: 12,
    position: 'absolute',
    right: 12
  },
  content: {
    gap: 12,
    padding: 16
  },
  p2pmdAppContent: {
    backgroundColor: '#1f2027',
    flexGrow: 1
  },
  runtimeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  title: {
    fontSize: 22,
    fontWeight: '700'
  },
  titleOnDark: {
    color: '#f1f2f7'
  },
  status: {
    fontSize: 14
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10
  },
  tabButton: {
    backgroundColor: '#f1f1f1',
    borderColor: '#d8d8d8',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  tabButtonActive: {
    backgroundColor: '#0f6fd4',
    borderColor: '#0f6fd4'
  },
  tabButtonText: {
    color: '#222',
    fontSize: 14,
    fontWeight: '600'
  },
  tabButtonTextActive: {
    color: '#fff'
  },
  input: {
    borderColor: '#bbb',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  section: {
    borderColor: '#ddd',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 10
  },
  p2pmdSection: {
    backgroundColor: '#1f2027',
    gap: 20,
    paddingVertical: 4
  },
  p2pmdHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  p2pmdHeaderCopy: {
    flex: 1,
    gap: 4
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600'
  },
  p2pmdTitle: {
    color: '#f1f2f7'
  },
  helperText: {
    color: '#a2a8bb',
    fontSize: 13,
    lineHeight: 19
  },
  fieldLabel: {
    color: '#8c93a8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  p2pmdInput: {
    backgroundColor: '#262832',
    borderColor: '#3a3d49',
    color: '#f1f2f7'
  },
  p2pmdSetupError: {
    backgroundColor: '#4b2430',
    borderColor: '#8f4c60',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffd6df',
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  result: {
    backgroundColor: '#f6f6f6',
    borderRadius: 8,
    padding: 10
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12
  },
  emptyRoomTitle: {
    color: '#f1f2f7',
    fontSize: 15,
    fontWeight: '700'
  },
  p2pmdSetupBlock: {
    gap: 10
  },
  p2pmdActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 4
  },
  p2pmdPrimaryAction: {
    alignItems: 'center',
    backgroundColor: '#2f80ed',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  p2pmdPrimaryActionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800'
  },
  p2pmdActionHint: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '600'
  },
  p2pmdTextAction: {
    alignItems: 'center',
    borderColor: '#384052',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  p2pmdTextActionText: {
    color: '#9ec5ff',
    fontSize: 13,
    fontWeight: '800'
  },
  p2pmdActionDisabled: {
    opacity: 0.5
  },
  p2pmdDividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginVertical: 2
  },
  p2pmdDividerLine: {
    backgroundColor: '#383b46',
    flex: 1,
    height: 1
  },
  p2pmdDividerText: {
    color: '#8c93a8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  p2pmdJoinAction: {
    alignItems: 'center',
    backgroundColor: '#1d513d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  p2pmdJoinActionText: {
    color: '#c6f6df',
    fontSize: 14,
    fontWeight: '800'
  },
  roomPill: {
    backgroundColor: '#30364a',
    borderRadius: 999,
    color: '#cdd6ff',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  roomPillLive: {
    backgroundColor: '#2f80ed',
    color: '#fff'
  }
})
