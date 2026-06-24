import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileSheet } from '@/components/profile-sheet';
import { Brand, Spacing } from '@/constants/theme';
import { getMe } from '@/lib/auth';
import { fetchUpcomingMeetings, Meeting } from '@/lib/meetings';

// PRD 4.2: 시간대별 인사 메시지 — 디바이스 로컬 시간(HH) 기준, 시간대마다 3~5개 중 하루 1개를 랜덤 노출.
const GREETING_CANDIDATES: { range: [number, number]; messages: string[] }[] = [
  { range: [0, 6], messages: ['아직 일하고 계신가요, {name}님? 오늘도 응원해요 🌙', '늦은 시간이네요, {name}님 🌙 잠시 쉬어가도 좋아요'] },
  { range: [6, 10], messages: ['좋은 아침이에요, {name}님 ☀️ 오늘 성공적인 미팅을 기원해요', '상쾌한 아침이에요, {name}님 ☀️ 오늘도 좋은 하루 되세요'] },
  { range: [10, 12], messages: ['좋은 하루예요, {name}님 🌿 오늘 수출 협상을 응원해요'] },
  { range: [12, 14], messages: ['점심 시간이에요, {name}님 🍱 오후 미팅도 힘내세요'] },
  { range: [14, 18], messages: ['오늘도 열심히 하고 계시군요, {name}님 💪 좋은 성과 기원해요'] },
  { range: [18, 21], messages: ['수고하셨어요, {name}님 🌆 오늘 하루도 잘 마무리하세요'] },
  { range: [21, 24], messages: ['오늘 하루도 고생하셨어요, {name}님 🌟 내일도 응원해요'] },
];

function pickGreeting(name: string | null): string {
  const hour = new Date().getHours();
  const slot = GREETING_CANDIDATES.find(({ range }) => hour >= range[0] && hour < range[1]);
  const messages = slot?.messages ?? GREETING_CANDIDATES[0].messages;
  // "매일 같은 메시지" 노출을 위해 날짜를 시드로 사용 (당일 내에는 고정, 날짜가 바뀌면 갱신)
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const message = messages[dayOfYear % messages.length];
  return message.replace('{name}', name?.trim() ? name.trim() : '');
}

function formatDateGroupLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86400000,
  );

  const label = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  if (diffDays === 0) return `${label} (오늘)`;
  if (diffDays === 1) return `${label} · 내일`;
  if (diffDays > 1) return `${label} · ${diffDays}일 뒤`;
  return label;
}

function formatTimeMeta(meeting: Meeting): string {
  const at = meeting.scheduled_at ?? meeting.started_at;
  const time = at
    ? new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  if (meeting.project_name) {
    const project =
      meeting.project_name.length > 20
        ? `${meeting.project_name.slice(0, 20)}…`
        : meeting.project_name;
    return `${time} · ${project}`;
  }
  return time;
}

type MeetingGroup = { dateKey: string; label: string; meetings: Meeting[] };

function groupMeetingsByDate(meetings: Meeting[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  for (const meeting of meetings) {
    const at = meeting.scheduled_at ?? meeting.started_at ?? meeting.ended_at;
    if (!at) continue;
    const date = new Date(at);
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!groups.has(dateKey)) {
      groups.set(dateKey, { dateKey, label: formatDateGroupLabel(at), meetings: [] });
    }
    groups.get(dateKey)!.meetings.push(meeting);
  }
  return Array.from(groups.values());
}

function MeetingRow({ meeting, isLast }: { meeting: Meeting; isLast: boolean }) {
  const isLive = meeting.status === 'active';

  function handlePress() {
    if (isLive) {
      Alert.alert('통역 세션은 준비 중이에요', '곧 라이브 세션으로 바로 연결할 수 있게 될게요.');
    } else {
      Alert.alert('미팅 상세 화면은 준비 중이에요');
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.meetingRow, !isLast && styles.meetingRowDivider]}
      accessibilityLabel={`${meeting.title ?? '미팅'}, ${formatTimeMeta(meeting)}`}>
      <View style={styles.meetingRowText}>
        <View style={styles.meetingTitleLine}>
          <Text style={styles.meetingTitle} numberOfLines={1}>
            {meeting.title ?? '제목 없는 미팅'}
          </Text>
          {isLive && (
            <View style={styles.liveBadge} accessibilityLabel="현재 진행 중">
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          )}
        </View>
        {!!formatTimeMeta(meeting) && <Text style={styles.meetingMeta}>{formatTimeMeta(meeting)}</Text>}
      </View>
      <Text style={styles.arrowIcon}>‹</Text>
    </Pressable>
  );
}

export default function MainScreen() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  // 구독/정보 페이지로 나갔다가 돌아왔을 때 Profile Sheet를 다시 열어주기 위한 플래그.
  const pendingReopenProfile = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (pendingReopenProfile.current) {
        pendingReopenProfile.current = false;
        setProfileVisible(true);
      }
    }, []),
  );

  const load = useCallback(async () => {
    try {
      const [meetingsResult, me] = await Promise.all([fetchUpcomingMeetings(), getMe()]);
      setMeetings(meetingsResult);
      setUserName(me.user.name);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const groups = useMemo(() => groupMeetingsByDate(meetings), [meetings]);
  const greeting = useMemo(() => pickGreeting(userName), [userName]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.topNav}>
        <Pressable
          hitSlop={8}
          onPress={() => Alert.alert('사이드 메뉴는 준비 중이에요')}
          accessibilityLabel="메뉴 열기"
          accessibilityHint="사이드 패널을 표시합니다">
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => setProfileVisible(true)}
          accessibilityLabel={`${userName ?? ''}님의 프로필`}
          style={styles.profileAvatar}>
          <Text style={styles.profileInitial}>{(userName ?? '?').trim().charAt(0)}</Text>
        </Pressable>
      </View>

      <ProfileSheet
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onNavigateAway={() => {
          pendingReopenProfile.current = true;
        }}
      />

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.primary} />
        }>
        {loading ? (
          <View style={styles.skeletonWrap}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow} />
            ))}
          </View>
        ) : loadError ? (
          <View style={styles.centerMessage}>
            <Text style={styles.errorText}>미팅 목록을 불러오지 못했어요. 다시 시도해주세요</Text>
            <Pressable onPress={load} style={styles.retryButton}>
              <Text style={styles.retryButtonLabel}>다시 시도</Text>
            </Pressable>
          </View>
        ) : meetings.length === 0 ? (
          <View style={styles.defaultMessage}>
            <Image
              source={require('@/assets/images/main/logo-icon.png')}
              style={styles.defaultLogo}
              contentFit="contain"
            />
            <Text style={styles.greetingText}>{greeting}</Text>
          </View>
        ) : (
          <View style={styles.meetingListCard}>
            {groups.map((group, groupIndex) => (
              <View key={group.dateKey} style={styles.meetingGroup}>
                <Text style={styles.dateLabel}>{group.label}</Text>
                {group.meetings.map((meeting, index) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    isLast={index === group.meetings.length - 1}
                  />
                ))}
                {groupIndex < groups.length - 1 && <View style={styles.groupDivider} />}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.choicePanel}>
        <Image
          source={require('@/assets/images/brand/preter-logo-primary.png')}
          style={styles.choiceLogo}
          contentFit="contain"
        />
        <View style={styles.choiceButtons}>
          <Pressable
            style={styles.joinButton}
            onPress={() => router.push('/guest-meeting-input')}
            accessibilityRole="button">
            <Text style={styles.joinButtonLabel}>미팅 참가하기</Text>
          </Pressable>
          <Pressable
            style={styles.createButton}
            onPress={() => router.push('/create-meeting')}
            accessibilityRole="button">
            <Text style={styles.createButtonLabel}>미팅 생성하기</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topNav: {
    height: 32,
    marginTop: Spacing.three + 4,
    paddingHorizontal: Spacing.three + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuIcon: {
    fontSize: 22,
    color: Brand.textPrimary,
  },
  profileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Brand.surfaceBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.primary,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.three + 4,
    paddingTop: Spacing.three,
    paddingBottom: 220,
  },
  skeletonWrap: {
    gap: 12,
    paddingTop: Spacing.five,
  },
  skeletonRow: {
    height: 40,
    borderRadius: 8,
    backgroundColor: Brand.surfaceBackground,
  },
  centerMessage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.six,
    gap: 16,
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
  defaultMessage: {
    flex: 1,
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  defaultLogo: {
    width: 38,
    height: 38,
  },
  greetingText: {
    fontSize: 22,
    fontWeight: '700',
    color: Brand.primary,
    textAlign: 'center',
    lineHeight: 30,
  },
  meetingListCard: {
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 16,
  },
  meetingGroup: {
    gap: 12,
  },
  dateLabel: {
    fontSize: 12,
    color: '#3451FF',
  },
  groupDivider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
    marginTop: 4,
  },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  meetingRowDivider: {},
  meetingRowText: {
    flex: 1,
    gap: 2,
  },
  meetingTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meetingTitle: {
    fontSize: 14,
    color: Brand.textPrimary,
    flexShrink: 1,
  },
  meetingMeta: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  liveBadge: {
    backgroundColor: '#FF334B',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'white',
  },
  arrowIcon: {
    fontSize: 16,
    color: Brand.textDisabled,
    transform: [{ rotate: '180deg' }],
  },
  choicePanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 20,
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 20,
    shadowColor: 'rgba(19,36,138,0.2)',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 30,
  },
  choiceLogo: {
    width: 66,
    height: 16,
  },
  choiceButtons: {
    gap: 12,
    width: '100%',
  },
  joinButton: {
    backgroundColor: 'white',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.primary,
  },
  createButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
});
