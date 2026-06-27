import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeftSidePanel } from '@/components/left-side-panel';
import { ProfileSheet } from '@/components/profile-sheet';
import { Snackbar } from '@/components/snackbar';
import { Brand, Spacing } from '@/constants/theme';
import { getMe } from '@/lib/auth';
import { Document, DocumentsApiError, fetchDocuments } from '@/lib/documents';
import {
  fetchRecentMeetings,
  fetchUpcomingMeetings,
  Meeting,
  MeetingsApiError,
  RecentMeeting,
} from '@/lib/meetings';
import i18n, { setAppLanguage } from '@/lib/i18n';
import { getMainScreenCache, getSidePanelCache, setMainScreenCache, setSidePanelCache } from '@/lib/main-screen-cache';
import { fetchProjects, Project, ProjectsApiError } from '@/lib/projects';
import { registerParticipant } from '@/lib/rooms';
import { getMyPlan, getMyProfile, MyPlan, MyProfile } from '@/lib/users';

// PRD 4.2: 시간대별 인사 메시지 — 디바이스 로컬 시간(HH) 기준, 시간대별로 정해진 문구 노출.
const GREETING_CANDIDATES: { range: [number, number]; key: string }[] = [
  { range: [0, 6], key: 'main.greetingLateNight' },
  { range: [6, 10], key: 'main.greetingMorning' },
  { range: [10, 12], key: 'main.greetingForenoon' },
  { range: [12, 14], key: 'main.greetingLunch' },
  { range: [14, 18], key: 'main.greetingAfternoon' },
  { range: [18, 21], key: 'main.greetingEvening' },
  { range: [21, 24], key: 'main.greetingNight' },
];

const LOCALE_BY_APP_LANGUAGE: Record<string, string> = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' };

function pickGreeting(name: string | null): string {
  const hour = new Date().getHours();
  const slot = GREETING_CANDIDATES.find(({ range }) => hour >= range[0] && hour < range[1]);
  const key = slot?.key ?? GREETING_CANDIDATES[0].key;
  return i18n.t(key, { name: name?.trim() ? name.trim() : '' });
}

function formatDateGroupLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86400000,
  );

  const label = i18n.t('main.dateLabel', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
  if (diffDays === 0) return i18n.t('main.dateToday', { label });
  if (diffDays === 1) return i18n.t('main.dateTomorrow', { label });
  if (diffDays > 1) return i18n.t('main.dateDaysLater', { label, days: diffDays });
  return label;
}

function formatTimeMeta(meeting: Meeting): string {
  const at = meeting.scheduled_at ?? meeting.started_at;
  const locale = LOCALE_BY_APP_LANGUAGE[i18n.language] ?? 'ko-KR';
  const time = at
    ? new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
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

// 실제 meetingListCard/meetingRow와 같은 모양(날짜 라벨 + 제목/메타 두 줄 + 화살표 자리)을
// 그대로 따라가는 스켈레톤 — 박스 3개로는 "로딩 중"이라는 느낌만 줄 뿐 실제 리스트와
// 형태가 달라 어색했다. pulse 애니메이션으로 살짝 깜빡여 로딩임을 알린다.
function SkeletonGroup({ rowWidths }: { rowWidths: number[] }) {
  return (
    <View style={styles.skeletonGroup}>
      <View style={styles.skeletonDateLabel} />
      {rowWidths.map((titleWidth, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonRowText}>
            <View style={[styles.skeletonLine, { width: `${titleWidth}%` }]} />
            <View style={[styles.skeletonLine, styles.skeletonLineSmall]} />
          </View>
          <View style={styles.skeletonArrow} />
        </View>
      ))}
    </View>
  );
}

function MeetingListSkeleton() {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.meetingListCard, styles.meetingListCardNoBorder, { opacity: pulse }]}>
      <SkeletonGroup rowWidths={[68, 48]} />
      <View style={styles.groupDivider} />
      <SkeletonGroup rowWidths={[55]} />
    </Animated.View>
  );
}

function MeetingRow({ meeting, isLast }: { meeting: Meeting; isLast: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const isLive = meeting.status === 'active';
  const [entering, setEntering] = useState(false);

  // PRD: 예약/진행 중 미팅 리스트 탭 → 호스트는 host-live-session, 멤버는 join-live-session으로
  // 재입장한다. waiting 상태면 각 화면이 자체적으로 대기 UI를 보여주고 자동 전환한다.
  async function handlePress() {
    if (entering) return;
    setEntering(true);
    try {
      if (meeting.is_host) {
        router.push({
          pathname: '/host-live-session',
          params: {
            room_id: meeting.id,
            room_code: meeting.room_code,
            title: meeting.title ?? t('main.untitledMeeting'),
            started: isLive ? '1' : undefined,
          },
        });
        return;
      }

      let language = meeting.language;
      if (isLive) {
        try {
          const profile = await getMyProfile();
          language = profile.primary_language;
        } catch {
          // 프로필 조회 실패해도 기본 언어로 진행.
        }
        await registerParticipant(meeting.id, { role: 'member', language, audio_enabled: true });
      }

      router.push({
        pathname: '/join-live-session',
        params: {
          room_id: meeting.id,
          room_code: meeting.room_code,
          title: meeting.title ?? t('main.untitledMeeting'),
          status: meeting.status,
        },
      });
    } catch {
      Alert.alert(t('main.cannotJoinTitle'), t('main.cannotJoinBody'));
    } finally {
      setEntering(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.meetingRow, !isLast && styles.meetingRowDivider]}
      accessibilityLabel={`${meeting.title ?? t('main.untitledMeeting')}, ${formatTimeMeta(meeting)}`}>
      <View style={styles.meetingRowText}>
        <View style={styles.meetingTitleLine}>
          <Text style={styles.meetingTitle} numberOfLines={1}>
            {meeting.title ?? t('main.noTitleMeeting')}
          </Text>
          {isLive && (
            <View style={styles.liveBadge} accessibilityLabel={t('main.liveAccessibilityLabel')}>
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
  const { t } = useTranslation();
  const { reservationSnackbar, meetingEndedSnackbar, refreshMeetings } = useLocalSearchParams<{
    reservationSnackbar?: string;
    meetingEndedSnackbar?: string;
    refreshMeetings?: string;
  }>();
  // 메인 화면은 router.replace('/main')으로 자주 재마운트되는데, 매번 스켈레톤부터
  // 다시 보여주면 안 된다 — 앱 켜진 동안 한 번 불러온 값은 모듈 캐시에서 즉시 채운다.
  const cachedMain = getMainScreenCache();
  const cachedSide = getSidePanelCache();
  const [meetings, setMeetings] = useState<Meeting[]>(cachedMain?.meetings ?? []);
  const [userName, setUserName] = useState<string | null>(cachedMain?.userName ?? null);
  const [loading, setLoading] = useState(cachedMain === null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(cachedMain?.profile ?? null);
  const [plan, setPlan] = useState<MyPlan | null>(cachedMain?.plan ?? null);
  const [leftPanelVisible, setLeftPanelVisible] = useState(false);
  const [sideProjects, setSideProjects] = useState<Project[]>(cachedSide?.projects ?? []);
  const [sideMeetings, setSideMeetings] = useState<RecentMeeting[]>(cachedSide?.meetings ?? []);
  const [sideDocuments, setSideDocuments] = useState<Document[]>(cachedSide?.documents ?? []);
  const [sideLoading, setSideLoading] = useState(cachedSide === null);
  const [sideLoadError, setSideLoadError] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  // 구독/정보 페이지로 나갔다가 돌아왔을 때 Profile Sheet를 다시 열어주기 위한 플래그.
  const pendingReopenProfile = useRef(false);

  useEffect(() => {
    if (reservationSnackbar) {
      setSnackbarMessage(decodeURIComponent(reservationSnackbar));
      setSnackbarVisible(true);
      router.setParams({ reservationSnackbar: undefined });
    }
  }, [reservationSnackbar, router]);

  useEffect(() => {
    if (meetingEndedSnackbar) {
      setSnackbarMessage(decodeURIComponent(meetingEndedSnackbar));
      setSnackbarVisible(true);
      router.setParams({ meetingEndedSnackbar: undefined });
    }
  }, [meetingEndedSnackbar, router]);

  useFocusEffect(
    useCallback(() => {
      if (pendingReopenProfile.current) {
        pendingReopenProfile.current = false;
        setProfileVisible(true);
      }
    }, []),
  );

  const load = useCallback(async () => {
    let nextMeetings = getMainScreenCache()?.meetings ?? [];
    let nextUserName = getMainScreenCache()?.userName ?? null;
    try {
      const [meetingsResult, me] = await Promise.all([fetchUpcomingMeetings(), getMe()]);
      nextMeetings = meetingsResult;
      nextUserName = me.user.name;
      setMeetings(meetingsResult);
      setUserName(me.user.name);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // 프로필/플랜은 메인 화면 진입 시 한 번에 받아와서 캐싱한다 — 프로필 바텀시트를
    // 열 때마다 새로 fetch하면 시트가 뜨는 순간 빈 데이터가 잠깐 보이는 지연이 생긴다.
    const [profileResult, planResult] = await Promise.all([
      getMyProfile().catch(() => null),
      getMyPlan().catch(() => null),
    ]);
    setProfile(profileResult);
    setPlan(planResult);
    setMainScreenCache({ meetings: nextMeetings, userName: nextUserName, profile: profileResult, plan: planResult });
    // 로그인 사용자의 명시적 app_language를 디바이스 로캘보다 우선 적용 (정책 §3).
    setAppLanguage(profileResult?.app_language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 이미 한 번 불러온 적 있으면(앱 켜진 동안 캐시 존재) 재마운트 시 다시 부르지 않는다 —
    // pull-to-refresh(handleRefresh)에서만 명시적으로 다시 부른다.
    if (getMainScreenCache() !== null) return;
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 미팅 조인/생성/종료 직후 메인으로 돌아왔을 때는 캐시가 있어도 한 번 강제로
  // 새로고침한다 — 위 캐시 우선 로직 때문에 방금 처리한 미팅이 리스트에 바로 안
  // 반영되는 문제(예약 등록, 미팅 종료 후 목록에서 사라짐 등)를 막기 위함.
  useEffect(() => {
    if (!refreshMeetings) return;
    load();
    router.setParams({ refreshMeetings: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMeetings]);

  // LeftSidePanel(미팅/자료 탭) 데이터 — 패널을 열 때마다 새로 fetch하면 매번 로딩이
  // 보였다. 메인 화면 진입 시 한 번에 미리 받아두고, 패널의 pull-to-refresh로만 재호출한다.
  const loadSidePanelData = useCallback(async () => {
    try {
      const [projectsResult, meetingsResult, documentsResult] = await Promise.all([
        fetchProjects(),
        fetchRecentMeetings(),
        fetchDocuments(),
      ]);
      setSideProjects(projectsResult);
      setSideMeetings(meetingsResult);
      setSideDocuments(documentsResult);
      setSideLoadError(false);
      setSidePanelCache({ projects: projectsResult, meetings: meetingsResult, documents: documentsResult });
    } catch (error) {
      if (error instanceof ProjectsApiError || error instanceof MeetingsApiError || error instanceof DocumentsApiError) {
        setSideLoadError(true);
      }
    }
  }, []);

  useEffect(() => {
    if (getSidePanelCache() !== null) return;
    setSideLoading(true);
    loadSidePanelData().finally(() => setSideLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <Snackbar visible={snackbarVisible} message={snackbarMessage} onHide={() => setSnackbarVisible(false)} />

      <View style={styles.topNav}>
        <Pressable
          hitSlop={8}
          onPress={() => setLeftPanelVisible(true)}
          accessibilityLabel={t('main.openMenu')}
          accessibilityHint={t('main.openMenuHint')}>
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => setProfileVisible(true)}
          accessibilityLabel={t('main.profileAccessibilityLabel', { name: userName ?? '' })}
          style={styles.profileAvatar}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.profileAvatarImage} />
          ) : (
            <Text style={styles.profileInitial}>{(userName ?? '?').trim().charAt(0)}</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.primary} />
        }>
        {loading ? (
          <MeetingListSkeleton />
        ) : loadError ? (
          <View style={styles.centerMessage}>
            <Text style={styles.errorText}>{t('main.loadError')}</Text>
            <Pressable onPress={load} style={styles.retryButton}>
              <Text style={styles.retryButtonLabel}>{t('main.retry')}</Text>
            </Pressable>
          </View>
        ) : groups.length === 0 ? (
          // meetings 배열에 항목이 있어도 그룹화(groupMeetingsByDate)에서 날짜 정보가 없어
          // 전부 걸러지거나, 미팅이 모두 종료돼 백엔드가 빈 배열을 내려주는 경우 등 —
          // 어떤 이유든 실제로 보여줄 그룹이 없으면 빈 박스 대신 미팅 없는 상태로 취급한다.
          <View style={styles.defaultMessage}>
            <Image
              source={require('@/assets/images/main/logo-emblem.png')}
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
            onPress={() => router.push('/join-meeting')}
            accessibilityRole="button">
            <Image
              source={require('@/assets/images/main/join-icon.png')}
              style={styles.choiceButtonIcon}
              contentFit="contain"
            />
            <Text style={styles.joinButtonLabel}>{t('main.joinMeeting')}</Text>
          </Pressable>
          <Pressable
            style={styles.createButton}
            onPress={() => router.push('/create-meeting')}
            accessibilityRole="button">
            <Image
              source={require('@/assets/images/main/create-icon.png')}
              style={styles.choiceButtonIcon}
              contentFit="contain"
            />
            <Text style={styles.createButtonLabel}>{t('main.createMeeting')}</Text>
          </Pressable>
        </View>
      </View>

      {/* LeftSidePanel/ProfileSheet는 더 이상 Modal이 아닌 일반 절대 위치 오버레이라
          touch/paint 순서가 JSX 트리 순서를 그대로 따른다 — 항상 최상단에서 받도록
          SafeAreaView의 마지막 자식으로 둔다. */}
      <LeftSidePanel
        visible={leftPanelVisible}
        onClose={() => setLeftPanelVisible(false)}
        projects={sideProjects}
        meetings={sideMeetings}
        documents={sideDocuments}
        loading={sideLoading}
        loadError={sideLoadError}
        onRefresh={loadSidePanelData}
        onProjectCreated={(project) => setSideProjects((prev) => [project, ...prev])}
      />

      <ProfileSheet
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onNavigateAway={() => {
          pendingReopenProfile.current = true;
        }}
        profile={profile}
        plan={plan}
        onProfileChange={setProfile}
      />
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
  profileAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  skeletonGroup: {
    gap: 12,
  },
  skeletonDateLabel: {
    width: 90,
    height: 12,
    borderRadius: 4,
    backgroundColor: Brand.surfaceBackground,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  skeletonRowText: {
    flex: 1,
    gap: 6,
  },
  skeletonLine: {
    height: 14,
    width: '70%',
    borderRadius: 4,
    backgroundColor: Brand.surfaceBackground,
  },
  skeletonLineSmall: {
    height: 10,
    width: '40%',
    borderRadius: 4,
    backgroundColor: Brand.surfaceBackground,
  },
  skeletonArrow: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: Brand.surfaceBackground,
    marginLeft: 12,
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
    fontSize: 16,
    fontWeight: '400',
    color: Brand.primary,
    textAlign: 'center',
    lineHeight: 24,
  },
  meetingListCard: {
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 16,
  },
  meetingListCardNoBorder: {
    borderWidth: 0,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
  choiceButtonIcon: {
    width: 20,
    height: 20,
  },
});
