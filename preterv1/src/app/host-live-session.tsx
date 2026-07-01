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
import { Brand, Spacing } from '@/constants/theme';
import { logCrashBreadcrumb, logEvent } from '@/lib/firebase';
import { LiveSessionEvent, RoomUser } from '@/lib/live-session';
import { getMyProfile } from '@/lib/users';
import { endRoom, fetchRoomDetail, leaveRoomAsMember, startRoom } from '@/lib/rooms';

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

const PLAY_ICON = require('@/assets/images/live-session/play-icon.png');
const STOP_ICON = require('@/assets/images/live-session/stop-icon.png');
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

// Host Live Session PRD v1.0.0 — 호스트 실시간 통역 세션 화면 (P0: 화면/상태머신/텍스트 이벤트).
// 오디오 캡처/재생(PCM 스트리밍)은 LiveAudioBridge(react-native-audio-api)가 담당한다.
export default function HostLiveSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    room_id: string;
    room_code: string;
    title: string;
    started?: string;
  }>();
  const { t } = useTranslation();
  const roomId = params.room_id;
  const roomCode = params.room_code ?? '';
  const meetingTitle = params.title ?? t('main.untitledMeeting');
  // Create Meeting PRD의 즉시입장 분기에서는 JoinMeetingSheet 확인 시점에 이미
  // PATCH .../start를 호출해 룸이 active 상태로 들어온다 — WAITING 화면을 또 보여줄 필요가 없다.
  const arrivedAlreadyStarted = params.started === '1';

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myDisplayName, setMyDisplayName] = useState('Host');
  const [myLanguage, setMyLanguage] = useState('ko');
  // handleEvent는 useCallback(..., [router])로 고정돼 있어서, 그 안에서 호출되는
  // upsertSpeakerBlock이 myUserId/myDisplayName/myLanguage를 "state 변수" 그대로
  // 읽으면 첫 렌더 시점(null/'Host'/'ko')에 박힌 값으로 영원히 고정된다 — getMyProfile()이
  // 비동기로 나중에 myUserId를 채워줘도 handleEvent 클로저는 그 갱신을 못 본다. 그 결과
  // 본인이 말한 SpeakerBlock의 isMine이 항상 false로 평가돼 왼쪽 정렬로 보이는 버그가
  // 있었다 — ref로 항상 최신값을 들고 있다가 그쪽을 읽게 한다.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const myDisplayNameRef = useRef(myDisplayName);
  myDisplayNameRef.current = myDisplayName;
  const myLanguageRef = useRef(myLanguage);
  myLanguageRef.current = myLanguage;
  // 비밀번호는 평문으로 DB에 저장되므로(짧은 숫자라 해시의 실익이 낮음) 사이드바를 열 때
  // 매번 API로 다시 조회한다 — 클라이언트 메모리에만 들고 있다가 앱 재시작 시 사라지는 문제를 없앤다.
  const [password, setPassword] = useState<string | null>(null);

  const [hasStarted, setHasStarted] = useState(arrivedAlreadyStarted);
  const [muted, setMuted] = useState(true);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  // 호스트/참가자가 각자 화면에 진입/시작한 시각부터 따로 카운트하면 헤더 시계가 서로
  // 달라 보였다 — 서버가 ROOM_STATE_UPDATE로 실어주는 미팅 실제 시작 시각(roomStartedAt)
  // 기준으로 전원이 동일한 경과 시간을 계산하게 한다.
  const [roomStartedAt, setRoomStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  const [startPopupVisible, setStartPopupVisible] = useState(false);
  // 호스트만 미팅을 "나가기"(본인만 퇴장, 미팅은 계속됨)와 "종료"(전원 종료)를 구분해야
  // 한다 — 이전엔 둘 다 같은 팝업/핸들러로 묶여있어서 뒤로가기만 눌러도 미팅 전체가
  // 끝나버리는 버그가 있었다.
  const [leavePopupVisible, setLeavePopupVisible] = useState(false);
  const [endPopupVisible, setEndPopupVisible] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const bridgeRef = useRef<LiveAudioBridgeHandle | null>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const openSpeakerIdRef = useRef<Map<string, string>>(new Map());
  // 화자별 무음 타임아웃 타이머(speakerId → timer). 델타가 올 때마다 리셋되고, 만료되면
  // 그 화자의 열린 블록을 확정한다(SPEAKER_INACTIVITY_MS 참조).
  const speakerFinalizeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollRef = useRef<ScrollView>(null);
  const autoStartedRef = useRef(false);

  // 동시 발화 지원: 현재 말하는 화자가 여럿일 수 있어 집합(activeSpeakerIds)으로 받는다.
  // 내 마이크가 음소거여도 다른 사람이 말하고 있으면 그 통역 오디오가 계속 들리므로
  // listening으로 표시한다 — 음소거가 무조건 우선하면 안 된다. 내가 말하는 중인지는
  // 집합에 내 id가 있는지로 판단한다.
  const otherIsSpeaking = activeSpeakerIds.some((id) => id !== myUserId);
  const meSpeaking = myUserId !== null && activeSpeakerIds.includes(myUserId);
  const audioState: AudioState = !hasStarted
    ? 'muted'
    : muted
      ? otherIsSpeaking
        ? 'listening'
        : 'muted'
      : meSpeaking
        ? 'speaking'
        : 'listening';

  // ---- 초기화: 내 프로필 + WebSocket 연결 -------------------------------

  useEffect(() => {
    logCrashBreadcrumb(`host-live-session: mount roomId=${roomId} arrivedAlreadyStarted=${arrivedAlreadyStarted}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 언마운트 시 남아있는 화자별 무음 타임아웃 타이머를 모두 정리한다.
  useEffect(() => {
    const timers = speakerFinalizeTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        setMyUserId(profile.id);
        setMyDisplayName(profile.name?.trim() || 'Host');
        setMyLanguage(profile.primary_language);
        // 네이티브 오디오 엔진이 소켓을 붙이기 전(첫 ROOM_STATE_UPDATE 도착 전)에 참가자
        // 사이드바를 열면 명단이 비어 보이는 버그가 있었다 — 호스트 자신을 먼저 채워둔다.
        // 소켓이 연결되면 ROOM_STATE_UPDATE가 이 값을 그대로 덮어쓴다.
        const myEntry: RoomUser = {
          userId: profile.id,
          displayName: profile.name?.trim() || 'Host',
          language: profile.primary_language,
          role: 'host',
          avatarUrl: profile.avatar_url,
        };
        usersRef.current = [myEntry];
        setUsers([myEntry]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (arrivedAlreadyStarted) logEvent('interpretation_session_start', { room_id: roomId, role: 'host' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roomId) return;
    fetchRoomDetail(roomId)
      .then((detail) => setPassword(detail.password))
      .catch(() => {});
  }, [roomId]);

  // 라이브 세션 소켓은 LiveAudioBridge(네이티브 오디오 엔진)가 단독 소유한다 — 여기서
  // 별도 WebSocket을 또 열면 서버가 user_id로 참가자를 덮어써 충돌하므로 열지 않는다.
  // 서버가 idle 연결을 끊지 않도록 주기적으로 PING을 보낸다(서버는 무시).
  useEffect(() => {
    const timer = setInterval(() => bridgeRef.current?.send({ type: 'PING' }), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hasStarted) return;
    // roomStartedAt이 아직 안 도착했으면(ROOM_STATE_UPDATE 수신 전) 0부터 보여주다가
    // 도착하는 즉시 실제 경과 시간으로 보정된다.
    const tick = () => {
      if (!roomStartedAt) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(roomStartedAt).getTime()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hasStarted, roomStartedAt]);

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
          break;
        }
        case 'SUBTITLE_ORIGINAL': {
          // Gemini Live의 input_audio_transcription은 누적본이 아니라 조각(delta)으로
          // 도착한다 — 그래서 매번 덮어쓰면 마지막 조각 단어만 남는다. 발화 턴이 끝날 때까지
          // 계속 이어붙여서 실시간 타이핑처럼 보이게 한다.
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
          // 호스트 본인이 종료한 경우는 handleConfirmEndMeeting에서 이미 직접 이동시키므로,
          // 이 분기는 (이론상) 다른 경로로 방이 끝났을 때를 대비한 안전망이다.
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
    [router],
  );

  // 메인으로 돌아갈 때 공통 처리 — toastMessage가 있으면 상단 토스트로 띄우고,
  // refreshMeetings는 항상 같이 보내서 메인 화면 캐시를 한 번 강제로 새로고침시킨다
  // (방금 끝난 미팅이 "예정된 미팅" 목록에서 즉시 사라지게 하기 위함).
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
      // 열린 블록 id 맵). 과거 floor control 시절엔 "현재 화자 1명만 open"을 강제로
      // 보장했지만, 이제 여러 화자가 동시에 말할 수 있으므로 각자의 블록을 독립적으로
      // 누적한다. 각 화자 블록은 그 화자의 TURN_COMPLETE에서만 마감된다.
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

  function handlePlayButtonPress() {
    if (!hasStarted) {
      setStartPopupVisible(true);
    } else {
      // 시작 후엔 이 버튼이 "미팅 종료"(전원 종료) 의미로 바뀐다 — 뒤로가기(나가기)와는 별개.
      setEndPopupVisible(true);
    }
  }

  // 예약 미팅(스케줄 시간이 미래)을 메인에서 다시 들어와 시작하는 경로는 started=1 없이
  // 도착하므로(arrivedAlreadyStarted=false) 여기서 사용자가 직접 "예"를 눌러야 시작된다.
  // 이전엔 이 함수가 로컬 UI 상태만 바꾸고 백엔드 PATCH .../start를 호출하지 않아서
  // meeting_rooms.status가 영원히 waiting으로 남고 started_at도 안 찍혔다 — 그 결과
  // 다른 참가자/요약 생성 등 status="active"를 가정하는 로직이 전부 어긋났다. 실제
  // 시작 시각도 "예약 시각"이 아니라 이 시점의 실제 시각으로 남도록 백엔드 호출을
  // 추가한다.
  async function handleConfirmStart() {
    setStartPopupVisible(false);
    if (!roomId) return;
    try {
      await startRoom(roomId);
    } catch {
      Alert.alert(t('hostLiveSession.startFailedTitle'), t('hostLiveSession.startFailedBody'));
      return;
    }
    setHasStarted(true);
    logEvent('interpretation_session_start', { room_id: roomId, role: 'host' });
    // PRD 변경: 호스트는 미팅 시작과 동시에 마이크가 켜진 상태로 진행된다(음소거 해제 +
    // 캡처 시작) — 시작하자마자 바로 말할 수 있어야 한다.
    setMuted(false);
    bridgeRef.current?.startMic();
    pushSystemMessage(t('hostLiveSession.meetingStarted', { title: meetingTitle }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // 음소거 해제 시점에 마이크 권한을 다시 확인한다 — 처음 거부했던 유저가 나중에 설정
  // 앱에서 권한을 직접 켜고 돌아온 경우, 굳이 화면을 나갔다가 다시 들어올 필요 없이
  // 음소거 버튼만 눌러도 바로 통역이 시작되게 한다.
  async function handleToggleMute() {
    if (!hasStarted) return;
    if (muted) {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        if (status === 'Denied') {
          Alert.alert(t('hostLiveSession.micPermissionDeniedTitle'), t('hostLiveSession.micPermissionDeniedBody'));
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

  // 호스트 본인만 퇴장 — 미팅은 계속된다. 종료 조건은 (a) 시작 후 전원 퇴장 또는
  // (b) 호스트의 명시적 "미팅 종료"뿐이므로, 여기서는 endRoom을 호출하지 않는다.
  // WS 연결이 끊기면 서버(room_state.py)가 참가자 목록에서만 제거하고, 남은 인원이
  // 있으면 미팅은 그대로 유지된다.
  // 개인 퇴장은 별도 안내 페이지 없이 바로 메인으로 돌아간다 — 미팅 자체는 계속되므로
  // 토스트도 띄우지 않는다.
  async function handleConfirmLeave() {
    setLeavePopupVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    bridgeRef.current?.close();
    try {
      if (roomId) await leaveRoomAsMember(roomId);
    } catch {
      // 퇴장 API 실패해도 클라이언트는 나간다.
    }
    logEvent('interpretation_session_end', { room_id: roomId, role: 'host', reason: 'host_left_personal' });
    navigateToMainAfterEnd();
  }

  // 호스트의 명시적 미팅 종료 — 전원에게 ROOM_ENDED가 브로드캐스트된다. 호스트 본인은
  // 별도 안내 페이지 없이 메인으로 이동하면서 상단 토스트로 종료 사실을 안내한다.
  async function handleConfirmEndMeeting() {
    setEndPopupVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    bridgeRef.current?.close();
    try {
      if (roomId) await endRoom(roomId);
    } catch {
      // 종료 API 실패해도 클라이언트는 나간다 — 사용자 대기시간을 늘리지 않기 위함.
    }
    logEvent('interpretation_session_end', { room_id: roomId, role: 'host', reason: 'host_ended' });
    navigateToMainAfterEnd(t('hostLiveSession.meetingEnded'));
  }

  const dots = '.'.repeat(dotCount);
  const statusText =
    audioState === 'muted'
      ? t('hostLiveSession.statusMuted')
      : audioState === 'speaking'
        ? t('hostLiveSession.statusSpeaking', { dots })
        : t('hostLiveSession.statusListening', { dots });
  const statusColor = audioState === 'muted' ? Brand.error : audioState === 'speaking' ? Brand.primary : Brand.textPrimary;
  const insets = useSafeAreaInsets();

  return (
    // bottom 인셋은 SafeAreaView가 아니라 bottomBar 자체의 paddingBottom으로 처리한다 —
    // 그래야 bottomBar 배경이 홈 인디케이터 영역까지 흰색으로 꽉 채워져 화면 최하단에
    // 딱 붙고(캡처 디자인 요구사항), 버튼/텍스트만 인셋만큼 위로 패딩된다.
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
            // 즉시입장 분기(arrivedAlreadyStarted)는 handleConfirmStart 팝업을 거치지 않아
            // "미팅이 시작되었습니다" 안내와 마이크 자동 on(PRD 정책)이 둘 다 빠져 있었다 —
            // 오디오 엔진이 준비된 시점에 한 번만 둘 다 처리한다.
            if (status === 'ready' && arrivedAlreadyStarted && !autoStartedRef.current) {
              autoStartedRef.current = true;
              pushSystemMessage(t('hostLiveSession.meetingStarted', { title: meetingTitle }));
              setMuted(false);
              bridgeRef.current?.startMic();
            }
          }}
        />
      ) : null}

      <View style={styles.topBar}>
        <Pressable onPress={() => setLeavePopupVisible(true)} hitSlop={8}>
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

      <View style={[styles.speakListenOrbWrap, { bottom: insets.bottom + BOTTOM_BAR_HEIGHT - 1 }]} pointerEvents="none">
        <SpeakListenOrb state={audioState === 'muted' ? 'idle' : audioState} />
      </View>

      <View style={[styles.bottomBar, { height: BOTTOM_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
        <PressableScale onPress={handlePlayButtonPress} style={styles.roundButton}>
          <Image source={hasStarted ? STOP_ICON : PLAY_ICON} style={styles.playButtonIcon} resizeMode="contain" />
        </PressableScale>
        {hasStarted && <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>}
        <PressableScale
          onPress={handleToggleMute}
          disabled={!hasStarted}
          style={[styles.roundButton, styles.micButton, muted ? styles.micButtonMuted : styles.micButtonActive]}>
          <Image source={muted ? MIC_ICON : MIC_ACTIVE_ICON} style={styles.micRoundIcon} resizeMode="contain" />
        </PressableScale>
      </View>

      {startPopupVisible && (
        <ConfirmPopup
          title={t('hostLiveSession.startPopupTitle')}
          description={t('hostLiveSession.startPopupDescription')}
          cancelLabel={t('common.no')}
          confirmLabel={t('common.yes')}
          confirmColor={Brand.primary}
          onCancel={() => setStartPopupVisible(false)}
          onConfirm={handleConfirmStart}
        />
      )}

      {leavePopupVisible && (
        <ConfirmPopup
          title={t('hostLiveSession.leavePopupTitle')}
          description={t('hostLiveSession.leavePopupDescription')}
          cancelLabel={t('common.no')}
          confirmLabel={t('common.yes')}
          confirmColor={Brand.error}
          onCancel={() => setLeavePopupVisible(false)}
          onConfirm={handleConfirmLeave}
        />
      )}

      {endPopupVisible && (
        <ConfirmPopup
          title={t('hostLiveSession.endPopupTitle')}
          description={t('hostLiveSession.endPopupDescription')}
          cancelLabel={t('common.no')}
          confirmLabel={t('common.yes')}
          confirmColor={Brand.error}
          onCancel={() => setEndPopupVisible(false)}
          onConfirm={handleConfirmEndMeeting}
        />
      )}

      {myUserId && (
        <ParticipantsSidebar
          visible={sidebarVisible}
          onClose={() => setSidebarVisible(false)}
          roomId={roomId ?? ''}
          roomCode={roomCode}
          password={password}
          meetingTitle={meetingTitle}
          hostName={myDisplayName}
          isHost
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
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonIcon: {
    width: 24,
    height: 24,
  },
  micRoundIcon: {
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
