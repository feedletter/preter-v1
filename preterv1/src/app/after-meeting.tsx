import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Brand } from '@/constants/theme';
import {
  fetchMeetingSummary,
  fetchSpeakerBlocks,
  MeetingSummary,
  SpeakerBlock,
} from '@/lib/meetings';
import i18n from '@/lib/i18n';

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36; // 5s * 36 = 3분 (PRD 폴링 전략)

const FLAG_BY_COUNTRY: Record<string, string> = {
  KR: '🇰🇷',
  US: '🇺🇸',
  JP: '🇯🇵',
  CN: '🇨🇳',
};

function flagEmoji(countryCode: string | null): string {
  if (!countryCode) return '';
  return FLAG_BY_COUNTRY[countryCode] ?? '';
}

function formatMeta(summary: MeetingSummary | null): string {
  if (!summary) return '';
  const parts: string[] = [];
  if (summary.started_at) {
    const d = new Date(summary.started_at);
    parts.push(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
  }
  if (summary.duration_minutes != null) parts.push(`${summary.duration_minutes}m`);
  if (summary.participants.length > 0) parts.push(summary.participants.join(', '));
  return parts.join(' · ');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Tab = 'summary' | 'script';

export default function AfterMeetingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { room_id } = useLocalSearchParams<{ room_id: string }>();

  const [tab, setTab] = useState<Tab>('summary');
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const pollAttempts = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSummary = useCallback(async () => {
    if (!room_id) return;
    try {
      const result = await fetchMeetingSummary(room_id);
      setSummary(result);
      setLoadError(false);
      return result;
    } catch {
      setLoadError(true);
      return null;
    }
  }, [room_id]);

  useEffect(() => {
    setLoading(true);
    loadSummary().finally(() => setLoading(false));
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [loadSummary]);

  // notes_status가 pending이면 분석 완료될 때까지 5초마다 최대 36회(3분) 폴링한다.
  useEffect(() => {
    if (summary?.notes_status !== 'pending') return;
    if (pollAttempts.current >= POLL_MAX_ATTEMPTS) return;

    pollTimer.current = setTimeout(async () => {
      pollAttempts.current += 1;
      await loadSummary();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [summary?.notes_status, loadSummary]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel={t('afterMeeting.back')} accessibilityRole="button">
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.topBarTextCol}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {summary?.title ?? t('afterMeeting.title')}
          </Text>
          {!!summary && <Text style={styles.topBarMeta} numberOfLines={1}>{formatMeta(summary)}</Text>}
        </View>
        <View style={styles.backIcon} />
      </View>

      <View style={styles.tabRow}>
        <Pressable style={styles.tabButton} onPress={() => setTab('summary')} accessibilityRole="button" accessibilityState={{ selected: tab === 'summary' }}>
          <Text style={[styles.tabLabel, tab === 'summary' && styles.tabLabelSelected]}>{t('afterMeeting.tabSummary')}</Text>
        </Pressable>
        <Pressable style={styles.tabButton} onPress={() => setTab('script')} accessibilityRole="button" accessibilityState={{ selected: tab === 'script' }}>
          <Text style={[styles.tabLabel, tab === 'script' && styles.tabLabelSelected]}>{t('afterMeeting.tabScript')}</Text>
        </Pressable>
      </View>

      {tab === 'summary' ? (
        <SummaryTab loading={loading} loadError={loadError} summary={summary} onRetry={loadSummary} />
      ) : (
        <ScriptTab roomId={room_id} />
      )}
    </SafeAreaView>
  );
}

function SummaryTab({
  loading,
  loadError,
  summary,
  onRetry,
}: {
  loading: boolean;
  loadError: boolean;
  summary: MeetingSummary | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <View style={styles.centerMessage}>
        <ActivityIndicator color={Brand.primary} />
      </View>
    );
  }

  if (loadError || summary?.notes_status === 'error') {
    return (
      <View style={styles.centerMessage}>
        <Text style={styles.errorText}>{t('afterMeeting.errorMessage')}</Text>
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonLabel}>{t('afterMeeting.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!summary || summary.notes_status === 'pending' || !summary.summary) {
    return (
      <View style={styles.centerMessage}>
        <View style={styles.waitPill}>
          <Text style={styles.waitPillText}>{t('afterMeeting.waitMessage')}</Text>
        </View>
      </View>
    );
  }

  const content = summary.summary;

  return (
    <FlatList
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      data={[content]}
      keyExtractor={() => 'summary-card'}
      renderItem={() => (
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>{t('afterMeeting.oneLinerSection')}</Text>
          <Text style={styles.oneLinerText}>{content.one_liner}</Text>

          <Text style={[styles.sectionTitle, styles.sectionSpacing]}>✅ {t('afterMeeting.decisionsSection')}</Text>
          {content.decisions.length === 0 ? (
            <Text style={styles.emptySectionText}>{t('afterMeeting.noDecisions')}</Text>
          ) : (
            content.decisions.map((decision, idx) => (
              <Text key={idx} style={styles.bulletText}>
                · {decision}
              </Text>
            ))
          )}

          <Text style={[styles.sectionTitle, styles.sectionSpacing]}>📌 {t('afterMeeting.actionItemsSection')}</Text>
          {content.action_items.length === 0 ? (
            <Text style={styles.emptySectionText}>{t('afterMeeting.noActionItems')}</Text>
          ) : (
            content.action_items.map((item, idx) => (
              <Text key={idx} style={styles.bulletText}>
                · {item.assignee ? `[${item.assignee}] ` : ''}
                {item.content}
                {item.due ? ` (${item.due})` : ''}
              </Text>
            ))
          )}

          <Text style={[styles.sectionTitle, styles.sectionSpacing]}>🗓 {t('afterMeeting.followUpSection')}</Text>
          {content.follow_up_schedule.length === 0 ? (
            <Text style={styles.emptySectionText}>{t('afterMeeting.noFollowUp')}</Text>
          ) : (
            content.follow_up_schedule.map((item, idx) => (
              <Text key={idx} style={styles.bulletText}>
                · {item.date ? `[${item.date}] ` : ''}
                {item.title}
                {item.note ? ` — ${item.note}` : ''}
              </Text>
            ))
          )}
        </View>
      )}
    />
  );
}

function ScriptTab({ roomId }: { roomId: string | undefined }) {
  const { t } = useTranslation();
  const [blocks, setBlocks] = useState<SpeakerBlock[]>([]);
  const [requesterLang, setRequesterLang] = useState<string>('en');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    fetchSpeakerBlocks(roomId)
      .then((page) => {
        setBlocks(page.speaker_blocks);
        setRequesterLang(page.requester_preferred_language);
        setHasMore(page.has_more);
        setNextBefore(page.next_before_sequence);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [roomId]);

  const loadMore = useCallback(async () => {
    if (!roomId || !hasMore || loadingMore || nextBefore == null) return;
    setLoadingMore(true);
    try {
      const page = await fetchSpeakerBlocks(roomId, nextBefore);
      setBlocks((prev) => [...prev, ...page.speaker_blocks]);
      setHasMore(page.has_more);
      setNextBefore(page.next_before_sequence);
    } catch {
      // 추가 로드 실패는 조용히 무시 — 이미 보이는 내용은 유지한다.
    } finally {
      setLoadingMore(false);
    }
  }, [roomId, hasMore, loadingMore, nextBefore]);

  if (loading) {
    return (
      <View style={styles.centerMessage}>
        <ActivityIndicator color={Brand.primary} />
      </View>
    );
  }

  if (blocks.length === 0) {
    return (
      <View style={styles.centerMessage}>
        <Text style={styles.emptySectionText}>{t('afterMeeting.noTranscript')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.scrollArea}
      contentContainerStyle={styles.scriptContent}
      data={blocks}
      keyExtractor={(item) => item.id}
      inverted
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={Brand.primary} style={styles.loadMoreSpinner} /> : null}
      renderItem={({ item }) => {
        const isOwn = item.original_language === requesterLang;
        const translation = item.translations?.[requesterLang];
        const showTranslation = !isOwn && !!translation;
        const isExpanded = !!expanded[item.id];

        return (
          <View style={[styles.speakerBlockRow, isOwn ? styles.speakerBlockRowOwn : styles.speakerBlockRowOther]}>
            <View style={styles.timePill}>
              <Text style={styles.timePillText}>
                {flagEmoji(item.country_code)} {isOwn ? t('afterMeeting.you') : item.speaker_name} {formatTime(item.started_at)}
              </Text>
            </View>
            <Text style={[styles.originalText, isOwn && styles.originalTextOwn]}>{item.original_text}</Text>
            {showTranslation && (
              <Pressable
                style={styles.englishBox}
                onPress={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}>
                <Text style={styles.englishBoxText} numberOfLines={isExpanded ? undefined : 1}>
                  {translation}
                </Text>
                <Text style={styles.englishBoxToggle}>
                  {isExpanded ? t('afterMeeting.collapse') : t('afterMeeting.expand')}
                </Text>
              </Pressable>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  backIcon: {
    fontSize: 26,
    color: Brand.textPrimary,
    width: 24,
  },
  topBarTextCol: {
    flex: 1,
    alignItems: 'center',
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  topBarMeta: {
    fontSize: 12,
    color: Brand.textSecondary,
    marginTop: 2,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  tabButton: {
    paddingVertical: 12,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Brand.textDisabled,
  },
  tabLabelSelected: {
    fontWeight: '700',
    color: Brand.textPrimary,
    textDecorationLine: 'underline',
  },
  scrollArea: {
    flex: 1,
    backgroundColor: Brand.surfaceBackground,
  },
  scrollContent: {
    padding: 16,
    flexGrow: 1,
  },
  centerMessage: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: Brand.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Brand.surfaceBackground,
  },
  retryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.primary,
  },
  waitPill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: Brand.surfaceBackground,
  },
  waitPillText: {
    fontSize: 13,
    color: Brand.textSecondary,
  },
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  sectionSpacing: {
    marginTop: 16,
  },
  oneLinerText: {
    fontSize: 13,
    color: Brand.textPrimary,
    marginTop: 6,
  },
  bulletText: {
    fontSize: 13,
    color: Brand.textPrimary,
    marginTop: 6,
    lineHeight: 19,
  },
  emptySectionText: {
    fontSize: 13,
    color: Brand.textDisabled,
    marginTop: 6,
  },
  scriptContent: {
    padding: 16,
    gap: 14,
  },
  loadMoreSpinner: {
    marginVertical: 12,
  },
  speakerBlockRow: {
    maxWidth: '85%',
    gap: 4,
  },
  speakerBlockRowOwn: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  speakerBlockRowOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  timePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timePillText: {
    fontSize: 11,
    color: Brand.textDisabled,
  },
  originalText: {
    fontSize: 14,
    color: Brand.textPrimary,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  originalTextOwn: {
    backgroundColor: Brand.primary,
    color: 'white',
  },
  englishBox: {
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  englishBoxText: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  englishBoxToggle: {
    fontSize: 11,
    color: Brand.primary,
    marginTop: 2,
  },
});
