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
import { SpeakListenOrb } from '@/components/speak-listen-orb';
import { Brand } from '@/constants/theme';
import { logEvent } from '@/lib/firebase';
import { leaveRoom } from '@/lib/guest';
import { LiveSessionEvent, RoomUser } from '@/lib/live-session';

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

// 같은 화자의 자막 델타가 이 시간 이상 끊기면 발화가 끝난 것으로 보고 블록을 확정한다.
// 상시 세션 모델에서 서버 TURN_COMPLETE가 발화마다 확실히 도착하지 않아, 같은 화자의 다음
// 발화가 이전 블록에 이어붙는 문제를 이 무음 타임아웃으로 보강한다(다음 델타는 새 블록 생성).
const SPEAKER_INACTIVITY_MS = 1500;

// Figma 392:26316 — bottom bar 전체 높이(흰 배경 영역).
// 버튼이 위치하는 콘텐츠 영역 높이. 실제 View height는 이 값 + insets.bottom으로
// 동적으로 설정해서 safe area padding이 콘텐츠 영역을 잠식하지 않도록 한다.
const BOTTOM_BAR_HEIGHT = 96;

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

// Guest Live Session PRD v1.0.0 — 게스트 실시간 통역 세션 화면.
// Host Live Session PRD와 구조가 거의 동일 — 차이점: BottomBar 좌측 빈 프레임(컨트롤 없음),
// 나가기는 개인 퇴장만(미팅 종료 불가), waiting 상태 미팅 입장 시 대기 화면 + 자동 전환.
export default function GuestLiveSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    room_id: string;
    room_code: string;
    title: string;
    status: string; // 'waiting' | 'active' — join 시점 검증된 미팅룸 상태.
    my_name: string;
    my_language: string;
    password?: string;
  }>();
  const { t } = useTranslation();
  const roomId = params.room_id;
  const meetingTitle = params.title ?? t('main.untitledMeeting');
  const myDisplayName = params.my_name ?? t('guestLiveSession.guestFallback');
  const myLanguage = params.my_language ?? 'ko';

  // 게스트는 본인 user_id를 별도로 조회할 계정이 없으므로, ROOM_STATE_UPDATE에서
  // 표시 이름으로 자신의 항목을 찾아 식별한다(같은 방에 동명이인이 거의 없는 MVP 가정).
  const [myUserId, setMyUserId] = useState<string | null>(null);
  // status: 'active'면 즉시 라이브 세션, 'waiting'이면 대기 화면 → ROOM_STATE_UPDATE로 자동 전환.
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'active'>(
    params.status === 'active' ? 'active' : 'waiting',
  );
  const [muted, setMuted] = useState(true);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
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
  // 화자별 무음 타임아웃 타이머(speakerId → timer). 델타가 올 때마다 리셋되고, 만료되면
  // 그 화자의 열린 블록을 확정한다(SPEAKER_INACTIVITY_MS 참조).
  const speakerFinalizeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollRef = useRef<ScrollView>(null);

  // 동시 발화 지원: 현재 말하는 화자가 여럿일 수 있어 집합(activeSpeakerIds)으로 받는다.
  // 내 마이크가 음소거여도 다른 사람이 말하면 그 통역 오디오가 들리므로 listening으로
  // 표시한다. 내가 말하는 중인지는 집합에 내 id가 있는지로 판단한다.
  const otherIsSpeaking = activeSpeakerIds.some((id) => id !== myUserId);
  const meSpeaking = myUserId !== null && activeSpeakerIds.includes(myUserId);
  const audioState: AudioState =
    roomStatus === 'waiting'
      ? 'muted'
      : muted
        ? otherIsSpeaking
          ? 'listening'
          : 'muted'
        : meSpeaking
          ? 'speaking'
          : 'listening';

  // ---- 라이브 세션 소켓은 LiveAudioBridge(네이티브 오디오 엔진)가 단독 소유한다 ----

  useEffect(() => {
    const timer = setInterval(() => bridgeRef.current?.send({ type: 'PING' }), 30000);
    return () => clearInterval(timer);
  }, []);

  // status:'active'로 막 입장한 경우와 'waiting'에서 자동 전환되는 경우 모두 한 번만 잡는다.
  const sessionStartLoggedRef = useRef(false);
  useEffect(() => {
    if (roomStatus !== 'active' || sessionStartLoggedRef.current) return;
    sessionStartLoggedRef.current = true;
    logEvent('interpretation_session_start', { room_id: roomId, role: 'guest' });
  }, [roomStatus, roomId]);

  // 언마운트 시 남아있는 화자별 무음 타임아웃 타이머를 모두 정리한다.
  useEffect(() => {
    const timers = speakerFinalizeTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // 호스트가 이미 시작해둔(진행 중인) 미팅에 바로 입장하는 경우 — usersRef를 본인으로
  // 미리 채워두기 때문에 ROOM_STATE_UPDATE 입장 알림 분기(다른 사람 입장 시에만 동작)가
  // 본인 입장 안내는 절대 띄워주지 않는다. 대기 화면에서 호스트 시작을 받아 전환되는
  // 경우는 그 분기에서 이미 안내가 뜨므로 중복되지 않게 여기선 최초 마운트 시 1회만 처리.
  useEffect(() => {
    if (params.status === 'active') {
      pushSystemMessage(t('guestLiveSession.joinedMeeting', { title: meetingTitle }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- WebSocket 이벤트 처리 ---------------------------------------------

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
              // 동명이인이 없다는 가정 하에 내 표시 이름과 일치하는 항목을 내 식별자로 채택.
              if (!myUserId && user.displayName === myDisplayName) {
                setMyUserId(user.userId);
              }
            }
          }
          for (const user of previous) {
            if (!nextIds.has(user.userId)) {
              pushSystemMessage(t('hostLiveSession.userLeft', { name: user.displayName }));
            }
          }

          usersRef.current = event.users;
          setUsers(event.users);
          setActiveSpeakerIds(event.activeSpeakerIds ?? []);
          if (event.startedAt) setRoomStartedAt(event.startedAt);
          // PRD 1.3/9 — waiting 중 호스트가 시작하면 status:"active" 수신 시 MUTED로 자동 전환.
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
    [router, myUserId, myDisplayName, roomStatus],
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
    // 델타가 도착할 때마다 이 화자의 무음 타임아웃을 리셋한다 — 발화가 이어지는 동안엔
    // 블록이 유지되고, 델타가 끊기면(발화 종료) 타이머가 블록을 확정해 다음 발화가 새
    // 블록으로 시작되게 한다.
    const timers = speakerFinalizeTimersRef.current;
    const pending = timers.get(speakerId);
    if (pending) clearTimeout(pending);
    timers.set(speakerId, setTimeout(() => finalizeSpeakerBlock(speakerId), SPEAKER_INACTIVITY_MS));

    setMessages((prev) => {
      // 동시 발화 지원: 화자마다 자기 블록을 따로 연다(openSpeakerIdRef는 speakerId →
      // 열린 블록 id 맵). 과거 floor control 시절엔 "현재 화자 1명만 open"을 강제했지만,
      // 이제 여러 화자가 동시에 말할 수 있어 각자의 블록을 독립 누적한다. 각 블록은 그
      // 화자의 TURN_COMPLETE에서만 마감된다.
      const next = prev;
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
      const isMine = speakerId === myUserId;
      const newBlock: SpeakerMessage = {
        id: `spk-${speakerId}-${Date.now()}`,
        kind: 'speaker',
        speakerId,
        displayName: speaker?.displayName ?? (isMine ? myDisplayName : t('hostLiveSession.participantFallback')),
        language: speaker?.language ?? myLanguage,
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
    const timer = speakerFinalizeTimersRef.current.get(speakerId);
    if (timer) {
      clearTimeout(timer);
      speakerFinalizeTimersRef.current.delete(speakerId);
    }
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

  // ---- 액션 -------------------------------------------------------------

  // 음소거 해제 시점에 마이크 권한을 다시 확인한다 — 처음 거부했던 유저가 나중에 설정
  // 앱에서 권한을 직접 켜고 돌아온 경우, 화면을 나갔다가 다시 들어올 필요 없이 음소거
  // 버튼만 눌러도 바로 통역이 시작되게 한다.
  async function handleToggleMute() {
    if (roomStatus !== 'active') return;
    if (muted) {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        if (status === 'Denied') {
          Alert.alert(t('guestLiveSession.micPermissionDeniedTitle'), t('guestLiveSession.micPermissionDeniedBody'));
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

  // Guest는 미팅 전체를 종료할 수 없다 — [네] 확인은 본인만 퇴장(개인 퇴장)시킨다. 별도
  // 안내 페이지 없이 바로 메인으로 돌아간다(미팅은 계속되므로 토스트도 띄우지 않음).
  async function handleConfirmLeave() {
    setExitPopupVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    bridgeRef.current?.close();
    try {
      await leaveRoom();
    } catch {
      // 퇴장 API 실패해도 클라이언트는 나간다 — 사용자 대기시간을 늘리지 않기 위함.
    }
    logEvent('interpretation_session_end', { room_id: roomId, role: 'guest', reason: 'guest_left' });
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

      <View style={[styles.speakListenOrbWrap, { bottom: insets.bottom + BOTTOM_BAR_HEIGHT - 1 }]} pointerEvents="none">
        <SpeakListenOrb state={audioState === 'muted' ? 'idle' : audioState} />
      </View>

      <View style={[styles.bottomBar, { height: BOTTOM_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
        {/* Guest는 미팅 진행 컨트롤이 없다 — 빈 프레임(Figma Node 297:23115/23187 동일 크기, 투명) */}
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
      {/* 자막은 서버가 델타(조각)로 스트리밍하므로 텍스트가 이어붙으며 자연히 타이핑처럼
          보인다. 과거 TypeWriter는 children이 바뀔 때마다 애니메이션을 인덱스 0부터 재시작해서,
          델타가 올 때마다 블록 전체가 처음부터 다시 타이핑되는 버그가 있었다 — 정적 Text로 렌더한다. */}
      <Text style={[styles.speakerText, message.isMine && styles.speakerTextMine]}>
        {primaryText ?? ''}
      </Text>

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
  // voice-bar는 bottomBar 상단에 1px 걸치게 배치하고, bottomBar(zIndex:1)가 하단부를 덮는다.
  speakListenOrbWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT - 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 0,
  },
  bottomBar: {
    // height는 JSX에서 BOTTOM_BAR_HEIGHT + insets.bottom으로 동적 설정
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 1,
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
