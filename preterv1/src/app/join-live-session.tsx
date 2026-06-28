import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarStack } from '@/components/avatar-stack';
import { LiveAudioBridge, LiveAudioBridgeHandle } from '@/components/live-audio-bridge';
import { ParticipantsSidebar } from '@/components/participants-sidebar';
import { PressableScale } from '@/components/pressable-scale';
import { ORB_RADIUS, SpeakListenOrb } from '@/components/speak-listen-orb';
import { Brand } from '@/constants/theme';
import { logEvent } from '@/lib/firebase';
import { LiveSessionEvent, RoomUser } from '@/lib/live-session';
import { leaveRoomAsMember } from '@/lib/rooms';
import { getMyProfile } from '@/lib/users';

type AudioState = 'muted' | 'speaking' | 'listening';

type SystemMessage = { id: string; kind: 'system'; text: string };
type SpeakerMessage = {
  id: string;
  kind: 'speaker';
  speakerId: string;
  displayName: string;
  language: string;
  isMine: boolean;
  time: string;
  originalText: string;
  translatedText: string | null;
  isFinal: boolean;
  englishExpanded: boolean;
};
type TimelineMessage = SystemMessage | SpeakerMessage;

const LANGUAGE_FLAGS: Record<string, string> = { ko: '🇰🇷', en: '🇺🇸', ja: '🇯🇵', zh: '🇨🇳' };

// Figma 392:26316 — bottom bar 전체 높이(흰 배경 영역).
const BOTTOM_BAR_HEIGHT = 82;

const MIC_ICON = require('@/assets/images/live-session/mic-icon.png');
const MIC_ACTIVE_ICON = require('@/assets/images/live-session/mic-active-icon.png');

function nowTimeLabel(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Member Join MeetingRoom PRD §5 — 로그인 멤버의 실시간 통역 세션 화면.
// host-live-session과 거의 동일 구조(★ 재사용) — 차이: 진행 시간은 입장 시점부터 카운트,
// 미팅 종료 권한 없음(나가기만 가능), BottomBar 좌측은 빈 프레임(컨트롤 없음).
export default function JoinLiveSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    room_id: string;
    room_code: string;
    title: string;
    password?: string;
    status?: string; // 'waiting' | 'active' — Main 화면에서 예약 미팅 재입장 시 전달.
  }>();
  const { t } = useTranslation();
  const roomId = params.room_id;
  const meetingTitle = params.title ?? t('main.untitledMeeting');

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myDisplayName, setMyDisplayName] = useState('Member');
  const [myLanguage, setMyLanguage] = useState('ko');
  // handleEvent는 useCallback(..., [router, roomStatus])로 고정돼 있어서, 그 안에서
  // 호출되는 upsertSpeakerBlock이 myUserId를 state 그대로 읽으면 첫 렌더 시점(null)에
  // 박힌 값으로 영원히 고정된다 — getMyProfile()이 비동기로 나중에 myUserId를 채워줘도
  // handleEvent 클로저는 그 갱신을 못 본다. 그 결과 본인이 말한 SpeakerBlock의 isMine이
  // 항상 false로 평가돼 왼쪽 정렬로 보이는 버그가 있었다 — ref로 항상 최신값을 읽게 한다.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const myDisplayNameRef = useRef(myDisplayName);
  myDisplayNameRef.current = myDisplayName;
  const myLanguageRef = useRef(myLanguage);
  myLanguageRef.current = myLanguage;
  // status:'waiting'으로 들어오면 호스트가 시작하기 전까지 대기 화면을 보여준다.
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'active'>(
    params.status === 'waiting' ? 'waiting' : 'active',
  );

  const [muted, setMuted] = useState(true);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  // 호스트/참가자가 각자 화면 진입/시작 시각부터 따로 카운트하면 헤더 시계가 서로
  // 달라 보였다 — 서버 ROOM_STATE_UPDATE의 실제 미팅 시작 시각 기준으로 통일한다.
  const [roomStartedAt, setRoomStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  const [exitPopupVisible, setExitPopupVisible] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const bridgeRef = useRef<LiveAudioBridgeHandle | null>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const openSpeakerIdRef = useRef<Map<string, string>>(new Map());
  const scrollRef = useRef<ScrollView>(null);

  // 내 마이크가 음소거 상태여도 다른 사람이 말하고 있으면(activeSpeakerId가 남) 그 통역
  // 오디오는 계속 들리므로 듣는 중(listening)으로 표시해야 한다 — 음소거가 무조건 우선하면
  // 안 된다. 다만 activeSpeakerId가 "나"로 남아있는 상태에서 방금 음소거를 누른 경우는
  // (서버가 무음 타임아웃으로 턴을 정리하기까지 수 초의 지연이 있다) 즉시 muted로
  // 보여줘야 한다. 그래서 "남이 말하는 중"인지를 먼저 확인하고, 아니면 내 음소거 여부를
  // 우선한다.
  const otherIsSpeaking = activeSpeakerId !== null && activeSpeakerId !== myUserId;
  const audioState: AudioState =
    roomStatus === 'waiting'
      ? 'muted'
      : otherIsSpeaking
        ? 'listening'
        : muted
          ? 'muted'
          : activeSpeakerId === myUserId
            ? 'speaking'
            : 'listening';

  const sessionStartLoggedRef = useRef(false);
  useEffect(() => {
    if (roomStatus !== 'active' || sessionStartLoggedRef.current) return;
    sessionStartLoggedRef.current = true;
    logEvent('interpretation_session_start', { room_id: roomId, role: 'member' });
  }, [roomStatus, roomId]);

  // 호스트가 이미 시작해둔(진행 중인) 미팅에 바로 입장하는 경우 — usersRef를 본인으로
  // 미리 채워두기 때문에 ROOM_STATE_UPDATE 입장 알림 분기(다른 사람 입장 시에만 동작)가
  // 본인 입장 안내는 절대 띄워주지 않는다. 대기 화면에서 호스트 시작을 받아 전환되는
  // 경우는 그 분기에서 이미 안내가 뜨므로 중복되지 않게 여기선 최초 마운트 시 1회만 처리.
  useEffect(() => {
    if (params.status === 'active') {
      pushSystemMessage(t('joinLiveSession.joinedMeeting', { title: meetingTitle }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        setMyUserId(profile.id);
        setMyDisplayName(profile.name?.trim() || 'Member');
        setMyLanguage(profile.primary_language);
        // 소켓이 첫 ROOM_STATE_UPDATE를 보내기 전에 사이드바를 열면 명단이 비어 보이는
        // 버그가 있었다 — 본인을 먼저 채워두고, 연결되면 ROOM_STATE_UPDATE가 덮어쓴다.
        const myEntry: RoomUser = {
          userId: profile.id,
          displayName: profile.name?.trim() || 'Member',
          language: profile.primary_language,
          role: 'member',
          avatarUrl: profile.avatar_url,
        };
        usersRef.current = [myEntry];
        setUsers([myEntry]);
      })
      .catch(() => {});
  }, []);

  // 라이브 세션 소켓은 LiveAudioBridge(네이티브 오디오 엔진)가 단독 소유한다.
  useEffect(() => {
    const timer = setInterval(() => bridgeRef.current?.send({ type: 'PING' }), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (roomStatus !== 'active') return;
    const tick = () => {
      if (!roomStartedAt) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(roomStartedAt).getTime()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [roomStatus, roomStartedAt]);

  useEffect(() => {
    if (audioState === 'muted') return;
    const timer = setInterval(() => setDotCount((c) => (c % 3) + 1), 300);
    return () => clearInterval(timer);
  }, [audioState]);

  const handleEvent = useCallback(
    (event: LiveSessionEvent) => {
      switch (event.type) {
        case 'ROOM_STATE_UPDATE': {
          const previous = usersRef.current;
          const previousIds = new Set(previous.map((u) => u.userId));
          const nextIds = new Set(event.users.map((u) => u.userId));

          for (const user of event.users) {
            if (!previousIds.has(user.userId)) {
              pushSystemMessage(t('hostLiveSession.userJoined', { name: user.displayName }));
            }
          }
          for (const user of previous) {
            if (!nextIds.has(user.userId)) {
              pushSystemMessage(t('hostLiveSession.userLeft', { name: user.displayName }));
            }
          }

          usersRef.current = event.users;
          setUsers(event.users);
          setActiveSpeakerId(event.activeSpeakerId);
          if (event.startedAt) setRoomStartedAt(event.startedAt);
          if (event.status === 'active' && roomStatus !== 'active') {
            setRoomStatus('active');
            pushSystemMessage(t('hostLiveSession.meetingStarted', { title: meetingTitle }));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          break;
        }
        case 'SUBTITLE_ORIGINAL': {
          // Gemini의 transcription은 누적본이 아니라 조각(delta)으로 도착한다 — 이어붙여야
          // 말한 그대로 실시간 타이핑처럼 보인다 (덮어쓰면 마지막 조각만 남는다).
          upsertSpeakerBlock(event.speakerId, (block) => {
            block.originalText += event.text;
          });
          break;
        }
        case 'SUBTITLE_TRANSLATED': {
          upsertSpeakerBlock(event.speakerId, (block) => {
            block.translatedText = (block.translatedText ?? '') + event.text;
          });
          break;
        }
        case 'TURN_COMPLETE': {
          finalizeSpeakerBlock(event.speakerId);
          break;
        }
        case 'FLOOR_OCCUPIED': {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
        }
        case 'ROOM_ENDED': {
          // 호스트가 종료한 경우 — 컨텐츠 영역에 안내 메세지를 띄운 채로 잠시 보여주고,
          // 메인으로 돌아가면서 동일한 안내를 상단 토스트로도 띄운다.
          pushSystemMessage(t('hostLiveSession.roomEndedByHost', { name: event.endedBy }));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setTimeout(() => navigateToMainAfterEnd(t('hostLiveSession.meetingEnded')), 1500);
          break;
        }
        case 'PARTICIPANT_KICKED': {
          Alert.alert(t('hostLiveSession.kicked'), undefined, [
            { text: t('createMeeting.confirm'), onPress: () => navigateToMainAfterEnd() },
          ]);
          break;
        }
        case 'INTERRUPTED':
          break;
      }
      scrollRef.current?.scrollToEnd({ animated: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, roomStatus],
  );

  // 메인으로 돌아갈 때 공통 처리 — toastMessage가 있으면 상단 토스트로 띄우고,
  // refreshMeetings는 항상 같이 보내 메인 화면의 미팅 목록을 강제로 새로고침시킨다.
  function navigateToMainAfterEnd(toastMessage?: string) {
    router.replace({
      pathname: '/main',
      params: {
        refreshMeetings: '1',
        ...(toastMessage ? { meetingEndedSnackbar: encodeURIComponent(toastMessage) } : {}),
      },
    });
  }

  function pushSystemMessage(text: string) {
    setMessages((prev) => [...prev, { id: `sys-${Date.now()}-${Math.random()}`, kind: 'system', text }]);
  }

  function upsertSpeakerBlock(speakerId: string, mutate: (block: SpeakerMessage) => void) {
    setMessages((prev) => {
      // Floor control상 동시에 열려 있는 발화 턴은 1개뿐이어야 한다. TURN_COMPLETE 누락 등
      // 어떤 이유로든 다른 화자 명의의 블록이 안 닫힌 채 남아 있으면, 화자A→화자B→화자A
      // 순서로 말했을 때 화자A의 두 번째 발화 텍스트가 직전(화자B 등)의 오래된 블록에
      // 잘못 이어붙는 버그가 있었다 — 새 이벤트가 들어오면 다른 화자 명의로 열려 있는
      // 블록을 먼저 강제로 마감해서, 항상 "현재 화자" 단 하나만 open 상태이게 보장한다.
      let next = prev;
      for (const [openSpeakerId, openId] of [...openSpeakerIdRef.current]) {
        if (openSpeakerId === speakerId) continue;
        openSpeakerIdRef.current.delete(openSpeakerId);
        next = next.map((m) => (m.id === openId && m.kind === 'speaker' ? { ...m, isFinal: true } : m));
      }

      const openId = openSpeakerIdRef.current.get(speakerId);
      const existingIndex = openId ? next.findIndex((m) => m.id === openId) : -1;

      if (existingIndex >= 0) {
        const updated = [...next];
        const block = { ...(updated[existingIndex] as SpeakerMessage) };
        mutate(block);
        updated[existingIndex] = block;
        return updated;
      }

      const speaker = usersRef.current.find((u) => u.userId === speakerId);
      const isMine = speakerId === myUserIdRef.current;
      const newBlock: SpeakerMessage = {
        id: `spk-${speakerId}-${Date.now()}`,
        kind: 'speaker',
        speakerId,
        displayName: speaker?.displayName ?? (isMine ? myDisplayNameRef.current : t('hostLiveSession.participantFallback')),
        language: speaker?.language ?? myLanguageRef.current,
        isMine,
        time: nowTimeLabel(),
        originalText: '',
        translatedText: null,
        isFinal: false,
        englishExpanded: false,
      };
      mutate(newBlock);
      openSpeakerIdRef.current.set(speakerId, newBlock.id);
      Haptics.impactAsync(isMine ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
      return [...next, newBlock];
    });
  }

  function finalizeSpeakerBlock(speakerId: string) {
    const openId = openSpeakerIdRef.current.get(speakerId);
    if (!openId) return;
    openSpeakerIdRef.current.delete(speakerId);
    setMessages((prev) =>
      prev.map((m) => (m.id === openId && m.kind === 'speaker' ? { ...m, isFinal: true } : m)),
    );
  }

  function toggleEnglishBox(blockId: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === blockId && m.kind === 'speaker' ? { ...m, englishExpanded: !m.englishExpanded } : m)),
    );
  }

  // 음소거 해제 시점에 마이크 권한을 다시 확인한다 — 처음 거부했던 유저가 나중에 설정
  // 앱에서 권한을 직접 켜고 돌아온 경우, 화면을 나갔다가 다시 들어올 필요 없이 음소거
  // 버튼만 눌러도 바로 통역이 시작되게 한다.
  async function handleToggleMute() {
    if (roomStatus !== 'active') return;
    if (muted) {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        if (status === 'Denied') {
          Alert.alert(t('joinLiveSession.micPermissionDeniedTitle'), t('joinLiveSession.micPermissionDeniedBody'));
        }
        return;
      }
      setMuted(false);
      bridgeRef.current?.startMic();
      return;
    }
    setMuted(true);
    bridgeRef.current?.stopMic();
  }

  // Member는 미팅 전체를 종료할 수 없다 — [네] 확인은 본인만 퇴장시킨다. 별도 안내
  // 페이지 없이 바로 메인으로 돌아간다(미팅은 계속되므로 토스트도 띄우지 않음).
  async function handleConfirmLeave() {
    setExitPopupVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    bridgeRef.current?.close();
    try {
      if (roomId) await leaveRoomAsMember(roomId);
    } catch {
      // 퇴장 API 실패해도 클라이언트는 나간다.
    }
    logEvent('interpretation_session_end', { room_id: roomId, role: 'member', reason: 'member_left' });
    navigateToMainAfterEnd();
  }

  const dots = '.'.repeat(dotCount);
  const statusText =
    roomStatus === 'waiting'
      ? t('joinLiveSession.waiting')
      : audioState === 'muted'
        ? t('hostLiveSession.statusMuted')
        : audioState === 'speaking'
          ? t('hostLiveSession.statusSpeaking', { dots })
          : t('hostLiveSession.statusListening', { dots });
  const statusColor = audioState === 'muted' ? Brand.error : audioState === 'speaking' ? Brand.primary : Brand.textPrimary;
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      {roomId ? (
        <LiveAudioBridge
          ref={bridgeRef}
          roomId={roomId}
          onEvent={handleEvent}
          onStatus={(status, detail) => {
            // ws_error는 엔진이 자동 재연결을 시도하므로(live-engine.html) 알림으로
            // 매번 끊어 보여주지 않는다 — 마이크 권한 등 실제 복구 불가 오류만 띄운다.
            if (status === 'error' && detail !== 'ws_error') {
              Alert.alert(
                t('hostLiveSession.audioErrorTitle'),
                detail === 'ws_rejected' ? t('hostLiveSession.connectionRejectedBody') : detail ?? t('hostLiveSession.unknownError'),
              );
            }
          }}
        />
      ) : null}

      <View style={styles.topBar}>
          <Pressable onPress={() => setExitPopupVisible(true)} hitSlop={8}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {meetingTitle}
          </Text>
          <View style={styles.topBarRight}>
            <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
            <Pressable onPress={() => setSidebarVisible(true)}>
              <AvatarStack users={users} />
            </Pressable>
          </View>
        </View>
        <View style={styles.topBarDivider} />

        {roomStatus === 'waiting' ? (
          <View style={styles.waitingContent}>
            {messages.map((message) =>
              message.kind === 'system' ? (
                <Text key={message.id} style={styles.systemMessage}>
                  {message.text}
                </Text>
              ) : null,
            )}
            <Text style={styles.waitingHint}>{t('joinLiveSession.waitingHint')}</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {messages.map((message) =>
              message.kind === 'system' ? (
                <Text key={message.id} style={styles.systemMessage}>
                  {message.text}
                </Text>
              ) : (
                <SpeakerBlockView key={message.id} message={message} onToggleEnglish={() => toggleEnglishBox(message.id)} />
              ),
            )}
          </ScrollView>
        )}

        <View style={styles.speakListenOrbWrap} pointerEvents="none">
          <SpeakListenOrb state={audioState === 'muted' ? 'idle' : audioState} />
        </View>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
          {/* Member는 미팅 진행 컨트롤이 없다 — 빈 프레임(나가기는 TopBar 뒤로가기로만 가능) */}
          <View style={styles.emptyLeftFrame} />
          {roomStatus === 'active' && (
            <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
          )}
          <PressableScale
            onPress={handleToggleMute}
            disabled={roomStatus !== 'active'}
            style={[styles.roundButton, styles.micButton, muted ? styles.micButtonMuted : styles.micButtonActive]}>
            <Image source={muted ? MIC_ICON : MIC_ACTIVE_ICON} style={styles.roundButtonIcon} resizeMode="contain" />
          </PressableScale>
        </View>

        {exitPopupVisible && (
          <ConfirmPopup
            title={t('hostLiveSession.leavePopupTitle')}
            description={t('joinLiveSession.exitPopupDescription')}
            cancelLabel={t('common.no')}
            confirmLabel={t('common.yes')}
            confirmColor={Brand.primary}
            onCancel={() => setExitPopupVisible(false)}
            onConfirm={handleConfirmLeave}
          />
        )}

        {myUserId && (
          <ParticipantsSidebar
            visible={sidebarVisible}
            onClose={() => setSidebarVisible(false)}
            roomId={roomId ?? ''}
            roomCode={params.room_code ?? ''}
            password={params.password ?? null}
            meetingTitle={meetingTitle}
            hostName={users.find((u) => u.role === 'host')?.displayName ?? t('joinLiveSession.hostFallback')}
            isHost={false}
            myUserId={myUserId}
            users={users}
          />
        )}
    </SafeAreaView>
  );
}

function SpeakerBlockView({
  message,
  onToggleEnglish,
}: {
  message: SpeakerMessage;
  onToggleEnglish: () => void;
}) {
  const { t } = useTranslation();
  const flag = LANGUAGE_FLAGS[message.language] ?? '🌐';
  const showTranslation = !message.isMine && message.translatedText && message.translatedText !== message.originalText;
  const primaryText = showTranslation ? message.translatedText : message.originalText;

  return (
    <View style={[styles.speakerBlock, message.isMine && styles.speakerBlockMine]}>
      <View style={styles.timePill}>
        <Text style={styles.timePillText}>
          {flag} {message.displayName}
          {message.isMine ? t('hostLiveSession.meIndicator') : ''} · {message.time}
        </Text>
      </View>
      <Text style={[styles.speakerText, message.isMine && styles.speakerTextMine]}>{primaryText}</Text>

      {showTranslation && (
        <Pressable style={styles.englishBox} onPress={onToggleEnglish}>
          <Text style={styles.englishBoxText} numberOfLines={message.englishExpanded ? undefined : 1}>
            {message.originalText}
          </Text>
          <View style={styles.englishBoxToggleRow}>
            <Text style={styles.englishBoxToggle}>
              {message.englishExpanded ? t('hostLiveSession.collapse') : t('hostLiveSession.expand')}
            </Text>
            {/* Figma 297:22594 — open(▾)/fold(▴) 폴리곤. 펼침 상태에 따라 180도 회전시켜
                하나의 화살표로 두 상태를 표현한다. */}
            <Text style={[styles.englishBoxChevron, message.englishExpanded && styles.englishBoxChevronExpanded]}>▾</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}


function ConfirmPopup({
  title,
  description,
  cancelLabel,
  confirmLabel,
  confirmColor,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmColor: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.popupDim}>
      <View style={styles.popupCard}>
        <Text style={styles.popupTitle}>{title}</Text>
        <Text style={styles.popupDescription}>{description}</Text>
        <View style={styles.popupButtonRow}>
          <Pressable style={styles.popupButton} onPress={onCancel}>
            <Text style={styles.popupButtonLabelCancel}>{cancelLabel}</Text>
          </Pressable>
          <Pressable style={styles.popupButton} onPress={onConfirm}>
            <Text style={[styles.popupButtonLabelConfirm, { color: confirmColor }]}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.surfaceBackground,
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backIcon: {
    fontSize: 28,
    color: '#1A1A1A',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'left',
    marginHorizontal: 8,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  avatarStack: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarStackLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Brand.primary,
  },
  topBarDivider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    gap: 24,
  },
  waitingContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 23,
  },
  waitingHint: {
    fontSize: 12,
    color: Brand.textDisabled,
    textAlign: 'center',
  },
  systemMessage: {
    fontSize: 12,
    color: Brand.textDisabled,
    textAlign: 'center',
  },
  speakerBlock: {
    gap: 8,
    alignItems: 'flex-start',
  },
  speakerBlockMine: {
    alignItems: 'flex-end',
  },
  timePill: {
    backgroundColor: Brand.borderDisabled,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  timePillText: {
    fontSize: 10,
    color: Brand.textSecondary,
  },
  speakerText: {
    fontSize: 14,
    lineHeight: 22,
    color: Brand.textPrimary,
  },
  speakerTextMine: {
    textAlign: 'right',
  },
  englishBox: {
    backgroundColor: '#F7F7F9',
    borderRadius: 12,
    padding: 10,
    width: '100%',
  },
  englishBoxText: {
    fontSize: 12,
    color: '#9A9A9A',
  },
  englishBoxToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  englishBoxChevron: {
    fontSize: 10,
    color: '#9A9A9A',
    transform: [{ rotate: '0deg' }],
  },
  englishBoxChevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  englishBoxToggle: {
    fontSize: 12,
    color: '#9A9A9A',
    textAlign: 'right',
  },
  // 오브의 가로 중심을 bottomBar 상단 경계선에 맞춘다 — 위쪽 절반만 보이고 아래쪽 절반은
  // bottomBar 배경에 가려진다 (host-live-session.tsx와 동일 패턴).
  speakListenOrbWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT - ORB_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    height: BOTTOM_BAR_HEIGHT,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  emptyLeftFrame: {
    width: 44,
    height: 44,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonIcon: {
    width: 20,
    height: 20,
  },
  micButton: {},
  micButtonMuted: {
    backgroundColor: Brand.error,
  },
  micButtonActive: {
    backgroundColor: '#333333',
  },
  statusText: {
    fontSize: 13,
  },
  popupDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupCard: {
    width: 283,
    backgroundColor: 'white',
    borderRadius: 24,
    paddingTop: 32,
    paddingBottom: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
  },
  popupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
  },
  popupDescription: {
    fontSize: 14,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: -8,
  },
  popupButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  popupButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupButtonLabelCancel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.border,
    textAlign: 'center',
  },
  popupButtonLabelConfirm: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
