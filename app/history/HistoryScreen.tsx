import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import SearchIcon from '../../assets/icons/bootstrap/search.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import XIcon from '../../assets/icons/bootstrap/x-circle.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { t } from '../i18n/i18n.mjs'
import { HistoryClearSheet, type HistoryClearChoice } from './HistoryClearSheet'
import {
  countBrowserHistoryRange,
  formatBrowserHistoryDay,
  formatBrowserHistoryTime,
  getBrowserHistoryClearRange,
  getBrowserHistoryDayStart,
  groupBrowserHistoryByDay,
  MAX_BROWSER_HISTORY_QUERY_LENGTH,
  searchBrowserHistory
} from './history-filters.mjs'
import type { BrowserHistoryItem } from './useBrowserHistory'

type HistoryRange = { from: number, to: number }

type HistoryDay = HistoryRange & {
  key: string
  items: BrowserHistoryItem[]
}

type HistoryScreenProps = {
  error: string | null
  isDark: boolean
  isReady: boolean
  items: BrowserHistoryItem[]
  onClear: () => void
  onClearRange: (range: HistoryRange) => void
  onClose: () => void
  onOpen: (url: string) => void
  onRemove: (item: BrowserHistoryItem) => void
}

export function HistoryScreen ({
  error,
  isDark,
  isReady,
  items,
  onClear,
  onClearRange,
  onClose,
  onOpen,
  onRemove
}: HistoryScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const [query, setQuery] = useState('')
  // The day the list is down to, by its key, or every day.
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [clearVisible, setClearVisible] = useState(false)
  const now = Date.now()
  const today = getBrowserHistoryDayStart(now)

  const days = useMemo(() => groupBrowserHistoryByDay(items) as HistoryDay[], [items])
  const day = dayKey ? days.find((item) => item.key === dayKey) || null : null
  const sections = useMemo(() => (day ? [day] : days)
    .map((item) => ({ ...item, data: searchBrowserHistory(item.items, query) as BrowserHistoryItem[] }))
    .filter((item) => item.data.length > 0), [day, days, query])

  // A day cleared away takes the filter with it.
  useEffect(() => {
    if (dayKey && !day) setDayKey(null)
  }, [dayKey, day])

  // The day picked comes first, unless it is today, which is a choice anyway.
  const clearChoices: HistoryClearChoice[] = []
  if (day && day.from !== today) {
    clearChoices.push({ key: 'day', label: formatBrowserHistoryDay(day.from, now), count: day.items.length })
  }
  for (const [key, label] of [
    ['hour', t('Last hour')],
    ['today', t('Today')],
    ['two-days', t('Today and yesterday')],
    ['all', t('All time')]
  ]) {
    clearChoices.push({ key, label, count: countBrowserHistoryRange(items, getBrowserHistoryClearRange(key, now)) })
  }

  function clear (key: string) {
    setClearVisible(false)
    if (key === 'all') {
      onClear()
      return
    }
    // The time is taken now, not when the sheet opened.
    const range = key === 'day' && day
      ? { from: day.from, to: day.to }
      : getBrowserHistoryClearRange(key, Date.now()) as HistoryRange | null
    if (range) onClearRange(range)
  }

  const trimmedQuery = query.trim()

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel={t('Close History')}
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
          onPress={onClose}
        >
          <ArrowLeftIcon width={22} height={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>{t('History')}</Text>
        <Pressable
          accessibilityLabel={t('Clear browsing history')}
          accessibilityRole='button'
          disabled={!isReady || items.length === 0}
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconButton,
            !isReady || items.length === 0 ? styles.disabled : null,
            pressed ? styles.pressed : null
          ]}
          onPress={() => setClearVisible(true)}
        >
          <TrashIcon width={21} height={21} color={palette.text} />
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {isReady && items.length > 0 && (
        <View style={styles.filters}>
          <View style={[styles.searchBox, { backgroundColor: palette.address, borderColor: palette.border }]}>
            <SearchIcon width={16} height={16} color={palette.mutedText} />
            <TextInput
              accessibilityLabel={t('Search history')}
              autoCapitalize='none'
              autoCorrect={false}
              clearButtonMode='while-editing'
              maxLength={MAX_BROWSER_HISTORY_QUERY_LENGTH}
              placeholder={t('Search history')}
              placeholderTextColor={palette.mutedText}
              returnKeyType='search'
              style={[styles.searchInput, { color: palette.text }]}
              value={query}
              onChangeText={setQuery}
            />
            {/* iOS has its own clear button in the field. */}
            {Platform.OS === 'android' && query.length > 0 && (
              <Pressable
                accessibilityLabel={t('Clear search')}
                accessibilityRole='button'
                hitSlop={10}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
                onPress={() => setQuery('')}
              >
                <XIcon width={18} height={18} color={palette.mutedText} />
              </Pressable>
            )}
          </View>
          {days.length > 1 && (
            <ScrollView
              horizontal
              contentContainerStyle={styles.days}
              keyboardShouldPersistTaps='handled'
              showsHorizontalScrollIndicator={false}
              style={styles.dayStrip}
            >
              <DayButton isDark={isDark} label={t('All')} selected={!day} onPress={() => setDayKey(null)} />
              {days.map((item) => (
                <DayButton
                  key={item.key}
                  isDark={isDark}
                  label={formatBrowserHistoryDay(item.from, now)}
                  selected={day?.key === item.key}
                  onPress={() => setDayKey(item.key)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {!isReady
        ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.accent} />
            <Text style={[styles.emptyText, { color: palette.mutedText }]}>{t('Loading history...')}</Text>
          </View>
          )
        : items.length === 0
          ? (
            <View style={styles.empty}>
              <HistoryIcon width={30} height={30} color={palette.mutedText} />
              <Text style={[styles.emptyText, { color: palette.mutedText }]}>{t('No browsing history yet.')}</Text>
            </View>
            )
          : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.url}
              contentContainerStyle={styles.list}
              keyboardDismissMode='on-drag'
              keyboardShouldPersistTaps='handled'
              stickySectionHeadersEnabled={false}
              ListEmptyComponent={(
                <View style={styles.noMatch}>
                  <Text style={[styles.emptyText, { color: palette.mutedText }]}>
                    {t('No page in your history matches "{query}".', { query: trimmedQuery })}
                  </Text>
                </View>
              )}
              renderSectionHeader={({ section }) => (
                <Text accessibilityRole='header' style={[styles.dayHeader, { color: palette.mutedText }]}>
                  {formatBrowserHistoryDay(section.from, now)}
                </Text>
              )}
              renderItem={({ item }) => (
                <View style={[styles.row, { borderBottomColor: palette.border }]}>
                  <Pressable
                    accessibilityLabel={t('Open {name}', { name: item.title })}
                    accessibilityRole='link'
                    style={({ pressed }) => [styles.rowContent, pressed ? styles.pressed : null]}
                    onPress={() => onOpen(item.url)}
                  >
                    <Text numberOfLines={1} style={[styles.itemTitle, { color: palette.text }]}>{item.title}</Text>
                    <View style={styles.itemDetails}>
                      <Text style={[styles.itemTime, { color: palette.mutedText }]}>
                        {formatBrowserHistoryTime(item.visitedAt)}
                      </Text>
                      <Text numberOfLines={1} style={[styles.itemUrl, { color: palette.mutedText }]}>{item.url}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t('Remove {name} from history', { name: item.title })}
                    accessibilityRole='button'
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeButton, pressed ? styles.pressed : null]}
                    onPress={() => onRemove(item)}
                  >
                    <TrashIcon width={19} height={19} color='#b83250' />
                  </Pressable>
                </View>
              )}
            />
            )}

      <HistoryClearSheet
        choices={clearChoices}
        isDark={isDark}
        visible={clearVisible}
        onChoose={clear}
        onClose={() => setClearVisible(false)}
      />
    </View>
  )
}

function DayButton ({
  isDark,
  label,
  selected,
  onPress
}: {
  isDark: boolean
  label: string
  selected: boolean
  onPress: () => void
}) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.dayButton,
        selected
          ? { backgroundColor: palette.selectedControl, borderColor: palette.selectedControl }
          : { backgroundColor: palette.address, borderColor: palette.border },
        pressed ? styles.pressed : null
      ]}
      onPress={onPress}
    >
      <Text style={[styles.dayButtonText, { color: selected ? (isDark ? palette.shell : '#ffffff') : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 14
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  title: { flex: 1, fontSize: 20, fontWeight: '700', marginHorizontal: 10 },
  errorBanner: { backgroundColor: '#5a2531', margin: 14, padding: 12, borderRadius: 8 },
  errorText: { color: '#ffd9e1', fontSize: 14 },
  filters: { gap: 10, paddingTop: 12 },
  searchBox: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    minHeight: 42,
    paddingHorizontal: 12
  },
  searchInput: { flex: 1, fontSize: 15, minHeight: 40, paddingVertical: 8 },
  dayStrip: { flexGrow: 0 },
  days: { gap: 8, paddingHorizontal: 16 },
  dayButton: {
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12
  },
  dayButtonText: { fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  noMatch: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  list: { paddingBottom: 24, paddingHorizontal: 16 },
  dayHeader: {
    fontSize: 13,
    fontWeight: '700',
    paddingBottom: 2,
    paddingHorizontal: 8,
    paddingTop: 18
  },
  row: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 76 },
  rowContent: { flex: 1, gap: 5, paddingHorizontal: 8, paddingVertical: 14 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  itemDetails: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  itemTime: { fontSize: 13, fontVariant: ['tabular-nums'] },
  itemUrl: { flex: 1, fontSize: 13 },
  removeButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 }
})
