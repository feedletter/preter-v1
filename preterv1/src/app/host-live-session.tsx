import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveAudioBridge, LiveAudioBridgeHandle } from '@/components/live-audio-bridge';
import { ParticipantsSidebar } from '@/components/participants-sidebar';
import { Brand, Spacing } from '@/constants/theme';
import { LiveSessionEvent, RoomUser } from '@/lib/live-session';
import { getMyProfile } from '@/lib/users';
import { endRoom, fetchRoomDetail } from '@/lib/rooms';

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
// 오디오 캡처/재생(PCM 스트리밍)은 네이티브 모듈 도입 후 다음 단계에서 연동한다.
export default function HostLiveSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    room_id: string;
    room_code: string;
    title: string;
    started?: string;
  }>();
  const roomId = params.room_id;
  const roomCode = params.room_code ?? '';
  const meetingTitle = params.title ?? '미팅';
  // Create Meeting PRD의 즉시입장 분기에서는 JoinMeetingSheet 확인 시점에 이미
  // PATCH .../start를 호출해 룸이 active 상태로 들어온다 — WAITING 화면을 또 보여줄 필요가 없다.
  const arrivedAlreadyStarted = params.started === '1';

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myDisplayName, setMyDisplayName] = useState('Host');
  const [myLanguage, setMyLanguage] = useState('ko');
  // 비밀번호는 평문으로 DB에 저장되므로(짧은 숫자라 해시의 실익이 낮음) 사이드바를 열 때
  // 매번 API로 다시 조회한다 — 클라이언트 메모리에만 들고 있다가 앱 재시작 시 사라지는 문제를 없앤다.
  const [password, setPassword] = useState<string | null>(null);

  const [hasStarted, setHasStarted] = useState(arrivedAlreadyStarted);
  const [muted, setMuted] = useState(true);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  const [startPopupVisible, setStartPopupVisible] = useState(false);
  const [exitPopupVisible, setExitPopupVisible] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [finished, setFinished] = useState(false);

  const bridgeRef = useRef<LiveAudioBridgeHandle | null>(null);
  const usersRef = useRef<RoomUser[]>([]);
  const openSpeakerIdRef = useRef<Map<string, string>>(new Map());
  const scrollRef = useRef<ScrollView>(null);

  // 내 마이크가 음소거 상태여도 다른 사람이 말하고 있으면(activeSpeakerId가 남) 그 통역
  // 오디오는 계속 들리므로 듣는 중(listening)으로 표시해야 한다 — 음소거가 무조건 우선하면
  // 안 된다. 아무도 말하지 않을 때만 내 음소거 여부로 상태를 결정한다.
  const audioState: AudioState = !hasStarted
    ? 'muted'
    : activeSpeakerId === myUserId
      ? 'speaking'
      : activeSpeakerId
        ? 'listening'
        : muted
          ? 'muted'
          : 'listening';

  // ---- 초기화: 내 프로필 + WebSocket 연결 -------------------------------

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        setMyUserId(profile.id);
        setMyDisplayName(profile.name?.trim() || 'Host');
        setMyLanguage(profile.primary_language);
        // WebView 오디오 엔진이 소켓을 붙이기 전(첫 ROOM_STATE_UPDATE 도착 전)에 참가자
        // 사이드바를 열면 명단이 비어 보이는 버그가 있었다 — 호스트 자신을 먼저 채워둔다.
        // 소켓이 연결되면 ROOM_STATE_UPDATE가 이 값을 그대로 덮어쓴다.
        const myEntry: RoomUser = {
          userId: profile.id,
          displayName: profile.name?.trim() || 'Host',
          language: profile.primary_language,
          role: 'host',
        };
        usersRef.current = [myEntry];
        setUsers([myEntry]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!roomId) return;
    fetchRoomDetail(roomId)
      .then((detail) => setPassword(detail.password))
      .catch(() => {});
  }, [roomId]);

  // 라이브 세션 소켓은 LiveAudioBridge(WebView 오디오 엔진)가 단독 소유한다 — 여기서
  // 별도 WebSocket을 또 열면 서버가 user_id로 참가자를 덮어써 충돌하므로 열지 않는다.
  // 서버가 idle 연결을 끊지 않도록 주기적으로 PING을 보낸다(서버는 무시).
  useEffect(() => {
    const timer = setInterval(() => bridgeRef.current?.send({ type: 'PING' }), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hasStarted) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [hasStarted]);

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
              pushSystemMessage(`${user.displayName} 님이 세션에 참가했습니다.`);
            }
          }
          for (const user of previous) {
            if (!nextIds.has(user.userId)) {
              pushSystemMessage(`${user.displayName} 님이 세션에서 나갔습니다.`);
            }
          }

          usersRef.current = event.users;
          setUsers(event.users);
          setActiveSpeakerId(event.activeSpeakerId);
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
        case 'FLOOR_OCCUPIED': {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
        }
        case 'ROOM_ENDED': {
          pushSystemMessage(`${event.endedBy} 님(호스트)이 미팅을 종료했습니다.`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setTimeout(() => router.replace('/main'), 2000);
          break;
        }
        case 'PARTICIPANT_KICKED': {
          Alert.alert('강퇴되었습니다', undefined, [{ text: '확인', onPress: () => router.replace('/main') }]);
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

  function pushSystemMessage(text: string) {
    setMessages((prev) => [...prev, { id: `sys-${Date.now()}-${Math.random()}`, kind: 'system', text }]);
  }

  function upsertSpeakerBlock(speakerId: string, mutate: (block: SpeakerMessage) => void) {
    setMessages((prev) => {
      const openId = openSpeakerIdRef.current.get(speakerId);
      const existingIndex = openId ? prev.findIndex((m) => m.id === openId) : -1;

      if (existingIndex >= 0) {
        const next = [...prev];
        const block = { ...(next[existingIndex] as SpeakerMessage) };
        mutate(block);
        next[existingIndex] = block;
        return next;
      }

      const speaker = usersRef.current.find((u) => u.userId === speakerId);
      const isMine = speakerId === myUserId;
      const newBlock: SpeakerMessage = {
        id: `spk-${speakerId}-${Date.now()}`,
        kind: 'speaker',
        speakerId,
        displayName: speaker?.displayName ?? (isMine ? myDisplayName : '참가자'),
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
      return [...prev, newBlock];
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

  // ---- 액션 -------------------------------------------------------------

  function handlePlayButtonPress() {
    if (!hasStarted) {
      setStartPopupVisible(true);
    } else {
      setExitPopupVisible(true);
    }
  }

  function handleConfirmStart() {
    setStartPopupVisible(false);
    setHasStarted(true);
    setMuted(true);
    pushSystemMessage(`${meetingTitle}이 시작되었습니다.`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleToggleMute() {
    if (!hasStarted) return;
    setMuted((prev) => {
      const next = !prev;
      // 음소거 해제 = 마이크 캡처 시작(PCM 스트리밍), 음소거 = 정지.
      if (next) bridgeRef.current?.stopMic();
      else bridgeRef.current?.startMic();
      return next;
    });
  }

  async function handleConfirmExit() {
    setExitPopupVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    bridgeRef.current?.close();
    try {
      if (roomId) await endRoom(roomId);
    } catch {
      // 종료 API 실패해도 클라이언트는 나간다 — 사용자 대기시간을 늘리지 않기 위함.
    }
    setFinished(true);
    setTimeout(() => router.replace('/main'), 800);
  }

  const dots = '.'.repeat(dotCount);
  const statusText = audioState === 'muted' ? '(음소거중..)' : audioState === 'speaking' ? `말하는 중${dots}` : `듣는 중${dots}`;
  const statusColor = audioState === 'muted' ? Brand.error : audioState === 'speaking' ? Brand.primary : Brand.textPrimary;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      {roomId ? (
        <LiveAudioBridge
          ref={bridgeRef}
          roomId={roomId}
          onEvent={handleEvent}
          onStatus={(status, detail) => {
            if (status === 'error') {
              Alert.alert('오디오 오류', detail ?? '알 수 없는 오류');
            }
          }}
        />
      ) : null}

      {finished ? (
        <View style={styles.finishedWrap}>
          <Text style={styles.finishedText}>미팅이 종료됐어요</Text>
        </View>
      ) : (
        <>
      <View style={styles.topBar}>
        <Pressable onPress={() => setExitPopupVisible(true)} hitSlop={8}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {meetingTitle}
        </Text>
        <View style={styles.topBarRight}>
          <Text style={styles.timerText}>{formatElapsed(elapsedSeconds)}</Text>
          <Pressable onPress={() => setSidebarVisible(true)} style={styles.avatarStack}>
            <Text style={styles.avatarStackLabel}>{users.length || 1}</Text>
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

      <SpeakListenBar state={audioState === 'muted' ? 'idle' : audioState} />

      <View style={styles.bottomBar}>
        <Pressable onPress={handlePlayButtonPress} style={styles.roundButton}>
          <Image source={hasStarted ? STOP_ICON : PLAY_ICON} style={styles.playButtonIcon} resizeMode="contain" />
        </Pressable>
        <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
        <Pressable
          onPress={handleToggleMute}
          disabled={!hasStarted}
          style={[styles.roundButton, styles.micButton, muted ? styles.micButtonMuted : styles.micButtonActive]}>
          <Image source={muted ? MIC_ICON : MIC_ACTIVE_ICON} style={styles.micRoundIcon} resizeMode="contain" />
        </Pressable>
      </View>

      {startPopupVisible && (
        <ConfirmPopup
          title="미팅을 시작할까요?"
          description="시작하면 참가자들이 통역 세션에 입장할 수 있어요."
          cancelLabel="아니오"
          confirmLabel="네"
          confirmColor={Brand.primary}
          onCancel={() => setStartPopupVisible(false)}
          onConfirm={handleConfirmStart}
        />
      )}

      {exitPopupVisible && (
        <ConfirmPopup
          title="미팅룸 나가기"
          description="미팅룸을 나가시겠습니까?"
          cancelLabel="아니오"
          confirmLabel="네"
          confirmColor={Brand.error}
          onCancel={() => setExitPopupVisible(false)}
          onConfirm={handleConfirmExit}
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
        </>
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
  const flag = LANGUAGE_FLAGS[message.language] ?? '🌐';
  const showTranslation = !message.isMine && message.translatedText && message.translatedText !== message.originalText;
  const primaryText = showTranslation ? message.translatedText : message.originalText;

  return (
    <View style={[styles.speakerBlock, message.isMine && styles.speakerBlockMine]}>
      <View style={styles.timePill}>
        <Text style={styles.timePillText}>
          {flag} {message.displayName}
          {message.isMine ? '(나)' : ''} · {message.time}
        </Text>
      </View>
      <Text style={[styles.speakerText, message.isMine && styles.speakerTextMine]}>{primaryText}</Text>

      {showTranslation && (
        <Pressable style={styles.englishBox} onPress={onToggleEnglish}>
          <Text style={styles.englishBoxText} numberOfLines={message.englishExpanded ? undefined : 1}>
            {message.originalText}
          </Text>
          <Text style={styles.englishBoxToggle}>{message.englishExpanded ? '접기' : '펼쳐보기'}</Text>
        </Pressable>
      )}
    </View>
  );
}

// speak-bar(Figma 392:26313)/listen-bar(186:2887) — 발화 상태에 따라 primary/error 색
// 발광 바가 발화 턴마다 깜빡인다. 안 말할 때는 배경색과 동일해 안 보인다(바텀바 바로 위 배치).
// speak-bar(Figma 84:420)/listen-bar(186:2887) 사이즈 — 375 기준 프레임 폭에 대한 비율로
// 변환해서 화면 폭에 관계없이 동일 비율을 유지한다. listen-bar가 speak-bar보다 더 길다.
const SPEAK_GLOW_WIDTH = '34.4%';
const SPEAK_LINE_WIDTH = '29.5%';
const LISTEN_GLOW_WIDTH = '54.7%';
const LISTEN_LINE_WIDTH = '46.9%';

// glow(Background gradient)는 막대(Rectangle)와 달리 불투명 색이 아니라 40% 알파 +
// 블러를 쓴다(Figma Layer blur). RN View엔 CSS blur 필터가 없어 shadow로 흉내낸다.
const SPEAK_GLOW_COLOR = 'rgba(20,40,160,0.4)';
const LISTEN_GLOW_COLOR = 'rgba(255,51,75,0.4)';

function SpeakListenBar({ state }: { state: 'speaking' | 'listening' | 'idle' }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const morph = useRef(new Animated.Value(state === 'listening' ? 1 : 0)).current;

  useEffect(() => {
    if (state === 'idle') {
      pulse.setValue(1);
      return;
    }
    pulse.setValue(1);
    // 발광(glow)과 막대 둘 다 발화 턴마다 같이 점멸한다.
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: false }),
      ]),
    );
    blink.start();
    // speak-bar ↔ listen-bar 전환 시 길이가 한 번 더 늘어났다가(overshoot) 목표 길이로
    // 줄어드는 탄성 모션을 주기 위해 spring을 사용 — width는 네이티브 드라이버 미지원이라 false.
    Animated.spring(morph, {
      toValue: state === 'listening' ? 1 : 0,
      useNativeDriver: false,
      bounciness: 14,
      speed: 8,
    }).start();
    return () => blink.stop();
  }, [state, pulse, morph]);

  if (state === 'idle') {
    return <View style={styles.speakListenBarWrap} />;
  }

  const lineColor = state === 'speaking' ? Brand.primary : Brand.error;
  const glowColor = state === 'speaking' ? SPEAK_GLOW_COLOR : LISTEN_GLOW_COLOR;
  const glowWidth = morph.interpolate({ inputRange: [0, 1], outputRange: [SPEAK_GLOW_WIDTH, LISTEN_GLOW_WIDTH] });
  const lineWidth = morph.interpolate({ inputRange: [0, 1], outputRange: [SPEAK_LINE_WIDTH, LISTEN_LINE_WIDTH] });

  return (
    <View style={styles.speakListenBarWrap}>
      <Animated.View
        style={[
          styles.speakListenGlow,
          { backgroundColor: glowColor, shadowColor: lineColor, opacity: pulse, width: glowWidth },
        ]}
      />
      <Animated.View style={[styles.speakListenLine, { backgroundColor: lineColor, opacity: pulse, width: lineWidth }]} />
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
  englishBoxToggle: {
    fontSize: 12,
    color: '#9A9A9A',
    textAlign: 'right',
    marginTop: 4,
  },
  // Figma 84:420/186:2887 — glow/막대를 bottomBar 상단 아웃라인보다 1px 위에 딱 붙여 배치.
  speakListenBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT + 1,
    height: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakListenGlow: {
    position: 'absolute',
    height: 4,
    borderRadius: 12,
    // Figma "Layer blur"(9px)를 RN에는 blur 필터가 없어 shadow로 흉내낸다.
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 9,
    elevation: 6,
  },
  speakListenLine: {
    height: 0.5,
    borderRadius: 1.5,
  },
  bottomBar: {
    height: BOTTOM_BAR_HEIGHT,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupButtonLabelCancel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.border,
  },
  popupButtonLabelConfirm: {
    fontSize: 15,
    fontWeight: '700',
  },
  finishedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
});
