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

// TopBar용 압축 한 줄 메타 — Figma 84:483의 TopBar(429:3160)는 "2026.05.09 ·12:09 · 62m"
// 형태의 숫자 위주 압축 표기를 쓴다(카드 안 헤더의 풀 날짜 표기와는 다른 용도).
function formatTopBarMeta(summary: MeetingSummary | null): string {
  if (!summary) return '';
  const parts: string[] = [];
  if (summary.started_at) {
    const d = new Date(summary.started_at);
    parts.push(
      `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ·${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
  }
  if (summary.duration_minutes != null) parts.push(`${summary.duration_minutes}m`);
  return parts.join(' · ');
}

// 카드 헤더용 풀 날짜/시간 표기 — Figma 429:3175 "2025년 8월 14일 (수) · 오후 2:00 – 3:12 · 72분".
// Intl이 로케일별(ko/en/ja)로 요일/오전오후 표기를 알아서 맞춰준다.
function formatCardMetaLine1(summary: MeetingSummary | null): string {
  if (!summary?.started_at) return '';
  const locale = i18n.language;
  const started = new Date(summary.started_at);
  const dateStr = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(
    started,
  );
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  const parts = [dateStr];
  const endIso = summary.ended_at;
  if (endIso) {
    parts.push(`${timeFormatter.format(started)} – ${timeFormatter.format(new Date(endIso))}`);
  } else {
    parts.push(timeFormatter.format(started));
  }
  if (summary.duration_minutes != null) parts.push(`${summary.duration_minutes}분`);
  return parts.join(' · ');
}

function formatCardMetaLine2(summary: MeetingSummary | null): string {
  return summary?.participants.join(' · ') ?? '';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function groupActionItemsByAssignee(
  items: { assignee: string; content: string; due: string }[],
): { assignee: string; items: { assignee: string; content: string; due: string }[] }[] {
  const order: string[] = [];
  const groups: Record<string, { assignee: string; content: string; due: string }[]> = {};
  for (const item of items) {
    const key = item.assignee || '';
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(item);
  }
  return order.map((assignee) => ({ assignee, items: groups[assignee] }));
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

      {/* Figma 84:483 TopBar(297:22943) — 뒤로가기 아이콘 옆에 제목/메타가 좌측 정렬로 붙는다
          (이전엔 제목 컬럼을 가운데 정렬하고 우측에 빈 스페이서를 둬서 중앙 타이틀처럼 보였음). */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel={t('afterMeeting.back')} accessibilityRole="button">
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.topBarTextCol}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {summary?.title ?? t('afterMeeting.title')}
          </Text>
          {!!summary && <Text style={styles.topBarMeta} numberOfLines={1}>{formatTopBarMeta(summary)}</Text>}
        </View>
      </View>

      {/* Figma 429:3133 "ordertaps" — 탭 전체 너비를 반씩 차지하고, 선택된 탭만 2px 검정
          밑줄 인디케이터가 붙는다(이전엔 좌우 패딩 20 + 텍스트 밑줄로 디자인이 달랐음). */}
      <View style={styles.tabRow}>
        <Pressable style={styles.tabButton} onPress={() => setTab('summary')} accessibilityRole="button" accessibilityState={{ selected: tab === 'summary' }}>
          <Text style={[styles.tabLabel, tab === 'summary' && styles.tabLabelSelected]}>{t('afterMeeting.tabSummary')}</Text>
          <View style={[styles.tabIndicator, tab === 'summary' && styles.tabIndicatorSelected]} />
        </Pressable>
        <Pressable style={styles.tabButton} onPress={() => setTab('script')} accessibilityRole="button" accessibilityState={{ selected: tab === 'script' }}>
          <Text style={[styles.tabLabel, tab === 'script' && styles.tabLabelSelected]}>{t('afterMeeting.tabScript')}</Text>
          <View style={[styles.tabIndicator, tab === 'script' && styles.tabIndicatorSelected]} />
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
  const actionGroups = groupActionItemsByAssignee(content.action_items);

  return (
    <FlatList
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      data={[content]}
      keyExtractor={() => 'summary-card'}
      renderItem={() => (
        // Figma 87:5 Content — 카드 헤더(제목+메타)가 한 줄 요약 라벨 없이 그 자체로
        // 카드의 헤드라인 역할을 하고, 섹션 사이는 marginTop이 아니라 gap:20으로 분리된다.
        <View style={styles.summaryCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderTitle}>{content.one_liner}</Text>
            <View>
              <Text style={styles.cardHeaderMeta}>{formatCardMetaLine1(summary)}</Text>
              <Text style={styles.cardHeaderMeta}>{formatCardMetaLine2(summary)}</Text>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>✅ {t('afterMeeting.decisionsSection')}</Text>
            {content.decisions.length === 0 ? (
              <Text style={styles.emptySectionText}>{t('afterMeeting.noDecisions')}</Text>
            ) : (
              content.decisions.map((decision, idx) => (
                <Text key={idx} style={styles.bulletText}>
                  · {decision}
                </Text>
              ))
            )}
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>📌 {t('afterMeeting.actionItemsSection')}</Text>
            {actionGroups.length === 0 ? (
              <Text style={styles.emptySectionText}>{t('afterMeeting.noActionItems')}</Text>
            ) : (
              actionGroups.map((group) => (
                <View key={group.assignee || '_'} style={styles.assigneeGroup}>
                  {!!group.assignee && <Text style={styles.assigneeName}>{group.assignee}</Text>}
                  {group.items.map((item, idx) => (
                    <Text key={idx} style={styles.bulletText}>
                      · {item.content}
                      {item.due ? ` ~ ${item.due}` : ''}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>🗓 {t('afterMeeting.followUpSection')}</Text>
            {content.follow_up_schedule.length === 0 ? (
              <Text style={styles.emptySectionText}>{t('afterMeeting.noFollowUp')}</Text>
            ) : (
              content.follow_up_schedule.map((item, idx) => (
                <Text key={idx} style={styles.bulletText}>
                  · {item.date ? `${item.date} · ` : ''}
                  {item.title}
                  {item.note ? ` — ${item.note}` : ''}
                </Text>
              ))
            )}
          </View>
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
    backgroundColor: Brand.surfaceBackground,
  },
  // Figma 297:22943 TopBar — 뒤로가기 아이콘 + 좌측 정렬 제목/메타 컬럼.
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  backIcon: {
    fontSize: 26,
    color: Brand.textPrimary,
    width: 24,
  },
  topBarTextCol: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 2,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  topBarMeta: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  // Figma 429:3133 "ordertaps" — 두 탭이 화면 너비를 절반씩 차지하고, 선택된 탭만
  // 텍스트 아래에 2px 검정 인디케이터가 붙는다(밑줄이 아니라 별도 바).
  tabRow: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: Brand.surfaceBackground,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 14,
    gap: 10,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textDisabled,
  },
  tabLabelSelected: {
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  tabIndicator: {
    height: 1,
    width: '100%',
    backgroundColor: Brand.borderDisabled,
  },
  tabIndicatorSelected: {
    height: 2,
    backgroundColor: Brand.textPrimary,
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
  // Figma 87:5 Content — 섹션 간 간격은 marginTop 누적이 아니라 카드 자체의 gap:20.
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    gap: 20,
  },
  cardHeader: {
    gap: 15,
  },
  cardHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.textPrimary,
    lineHeight: 22,
  },
  cardHeaderMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
    lineHeight: 13,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  assigneeGroup: {
    marginTop: 8,
    gap: 6,
  },
  assigneeName: {
    fontSize: 12,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  bulletText: {
    fontSize: 13,
    color: Brand.textPrimary,
    lineHeight: 19,
  },
  emptySectionText: {
    fontSize: 13,
    color: Brand.textDisabled,
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
