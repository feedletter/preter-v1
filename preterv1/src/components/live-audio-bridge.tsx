import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api';

import { logCrashBreadcrumb } from '@/lib/firebase';
import type { LiveSessionEvent } from '@/lib/live-session';

// 재생 스케줄링에 쓰는 노드/버퍼 타입을 AudioContext 메서드 반환형에서 끌어온다
// (라이브러리 export 이름에 의존하지 않기 위함).
type PlaybackSourceNode = ReturnType<AudioContext['createBufferSource']>;
type PlaybackBuffer = ReturnType<AudioContext['createBuffer']>;

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const WS_URL = API_URL.replace(/^http/, 'ws');
const TARGET_SR: number = 16000; // Gemini Live 입력 규격
// Gemini Live가 돌려주는 통역 오디오는 24kHz 고정 규격(공식 스펙) — 재생용 AudioContext를
// 이 값으로 고정한다. new AudioContext()를 옵션 없이 만들면 기기 하드웨어 네이티브
// sample rate(44100/48000 등 기기마다 다름)로 잡히는데, react-native-audio-api의 재생
// 노드가 버퍼 자체의 sampleRate와 context의 실제 출력 sampleRate가
// 다를 때 자동 리샘플링을 보장하지 않아 "다른 기기에서는 정상, 어떤 기기에서는 빠르거나
// 느리게 들리는" 간헐적 버그의 원인이 된다(2026-06-28 발견). context를 고정값으로
// 만들어 기기 하드웨어 native rate에 대한 의존을 완전히 없앤다.
const PLAYBACK_SR = 24000;
const MAX_RECONNECT_DELAY_MS = 10000;

// 재생 지터 버퍼(쿠션). Gemini 통역 오디오는 WS로 도착 간격이 들쭉날쭉한데, 각 버퍼를
// 오디오 클럭 위에 직접 예약(schedule)하면서 항상 이 시간만큼 앞세워 재생을 시작하면,
// 청크가 이 시간 이내로 늦게 와도 재생이 끊기지 않는다(underrun 흡수). 크면 안정적이지만
// 지연↑, 작으면 지연↓지만 끊김↑ — 150~250ms에서 튜닝. 통역 전체 지연(1~3초) 대비 미미.
const PLAYBACK_PREBUFFER_S = 0.2;

// 클라이언트 RMS(음량) 게이팅 임계값. 같은 좁은 공간에서 여러 명이 블루투스 이어폰을
// 끼고 말할 때, 옆 사람 목소리가 내 마이크에 물리적으로 새어 들어와(누출) 내 발화
// 세션이 옆 사람 말을 "내가 말한 것"으로 처리해버리는 문제가 있다. 누출된 주변 음성은
// 실제 발화자 본인 목소리보다 에너지가 훨씬 낮으므로, RMS가 이 값 이하인 청크는 서버로
// 보내지 않아 대부분 걸러낸다(iOS voiceChat 모드의 하드웨어 AEC와 2중 방어). 너무 높이면
// 작게 말하는 사람의 첫 음절이 잘리므로 보수적으로 잡고, 필요 시 튜닝한다.
const MIC_RMS_GATE = 0.012;

// 발화 종료 시 음량이 서서히 감쇠하는데(말끝), 그 구간이 MIC_RMS_GATE 아래로 떨어지면
// 마지막 단어의 오디오가 서버로 안 가 Gemini가 그 단어를 통역/전사하지 못한다("말끝
// 단어 누락" 버그). 한번 발화가 감지되면 이후 몇 청크는 게이트 아래여도 계속 통과시켜
// 말끝을 살린다(hangover). AudioRecorder bufferLength=2048 / TARGET_SR=16000 ≈ 128ms라
// 8청크 ≈ 1초 — 일반적인 말끝 감쇠 구간을 덮는다.
const VOICE_HANGOVER_CHUNKS = 8;

function computeRms(float32: Float32Array): number {
  if (float32.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

// 엔진(이제 네이티브 오디오 모듈)이 RN으로 올려보내는 오디오/소켓 생명주기 신호.
export type EngineStatus =
  | 'ready'
  | 'ws-open'
  | 'ws-close'
  | 'ws-reconnecting'
  | 'mic-started'
  | 'mic-stopped'
  | 'error';

export type LiveAudioBridgeHandle = {
  startMic: () => void;
  stopMic: () => void;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
};

type Props = {
  roomId: string;
  onEvent: (event: LiveSessionEvent) => void;
  onStatus?: (status: EngineStatus, detail?: string | null) => void;
};

function floatToInt16(float32: Float32Array): ArrayBuffer {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const v = Math.max(-1, Math.min(1, float32[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

// AudioRecorder가 요청한 sampleRate를 정확히 맞춰주지 않는 기기가 있을 수 있어
// (공식 문서: "실제 sample rate는 기기 성능에 따라 다를 수 있음") 방어적으로 유지한다.
function resample(buffer: Float32Array, fromSR: number, toSR: number): Float32Array {
  if (fromSR === toSR) return buffer;
  const factor = fromSR / toSR;
  const len = Math.round(buffer.length / factor);
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const raw = i * factor;
    const idx = Math.floor(raw);
    const next = Math.min(idx + 1, buffer.length - 1);
    const w = raw - idx;
    result[i] = buffer[idx] * (1 - w) + buffer[next] * w;
  }
  return result;
}

/**
 * 라이브 세션 헤드리스 오디오 엔진.
 *
 * 이전엔 WebView(브라우저 Web Audio API)로 마이크 캡처/재생/WebSocket을 처리했는데,
 * WebView의 ScriptProcessorNode + JS 스레드 기반 수동 재생 스케줄링이 GC/메시지 폭주에
 * 취약해 통역 오디오가 끊겨 들리는 문제가 있었다. react-native-audio-api(네이티브
 * 오디오 스레드)로 교체해 그 끊김을 구조적으로 없앤다. WebView가 빠지면서 Expo Go에서
 * getUserMedia가 막혀 있던 제약도 같이 해소되지만(다만 네이티브 모듈도 dev
 * client/정식 빌드가 필요한 건 동일하다), 화면 UI(host/join/guest-live-session.tsx)는
 * 이 컴포넌트가 쏘는 이벤트/상태 포맷이 그대로라 변경할 필요가 없다.
 */
export const LiveAudioBridge = forwardRef<LiveAudioBridgeHandle, Props>(
  ({ roomId, onEvent, onStatus }, ref) => {
    const wsRef = useRef<WebSocket | null>(null);
    const lastUrlRef = useRef<string | null>(null);
    const intentionalCloseRef = useRef(false);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const audioContextRef = useRef<AudioContext | null>(null);
    // 동시 발화 지원 + gapless 재생: 화자(speakerId)별로 재생 스케줄 상태를 따로 둔다.
    // playHeadRef: 그 화자의 "다음 버퍼를 시작할 오디오 클럭 시각(초)". 버퍼를 이 시각에
    // 예약하고 duration만큼 전진시켜 틈 없이 이어붙인다(화자별로 독립이라 동시 발화가
    // 겹쳐 재생된다). scheduledNodesRef: 예약/재생 중인 소스 노드 집합 — 바지-인(INTERRUPTED)
    // 정지와 언마운트 정리, 재생 완료 후 disconnect(누수 방지)에 쓴다.
    const playHeadRef = useRef<Map<string, number>>(new Map());
    const scheduledNodesRef = useRef<Map<string, Set<PlaybackSourceNode>>>(new Map());
    const recorderRef = useRef<AudioRecorder | null>(null);

    // RMS 게이팅 hangover 카운터: 발화가 감지된 뒤 말끝 감쇠 구간을 살리기 위해 남은
    // "게이트 아래여도 통과시킬" 청크 수. 발화 감지 시 VOICE_HANGOVER_CHUNKS로 리셋된다.
    const voiceHangoverRef = useRef(0);

    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;
    const onStatusRef = useRef(onStatus);
    onStatusRef.current = onStatus;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (intentionalCloseRef.current || !lastUrlRef.current || reconnectTimerRef.current) return;
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(1000 * 2 ** (reconnectAttemptsRef.current - 1), MAX_RECONNECT_DELAY_MS);
      onStatusRef.current?.('ws-reconnecting', `attempt:${reconnectAttemptsRef.current} delay:${delay}`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!intentionalCloseRef.current && lastUrlRef.current) openSocket(lastUrlRef.current, true);
      }, delay);
    }

    // 한 버퍼를 오디오 클럭 위 정확한 시각에 예약해 재생한다(gapless 스트리밍).
    // 큐 노드에 위임하지 않고 화자별 playHead를 직접 관리하는 이유: 큐 노드는 청크 도착
    // 지연으로 비면(drain) 재생이 끊기거나(chopping) 재개가 매끄럽지 않았다. 각 버퍼를
    // 직전 버퍼 끝(playHead)에 딱 붙여 예약하되, 뒤처졌으면(underrun) 쿠션(PLAYBACK_PREBUFFER_S)
    // 만큼 다시 앞세워 자가복구한다.
    function scheduleBuffer(speakerId: string, buffer: PlaybackBuffer) {
      const context = audioContextRef.current;
      if (!context) return;
      const src = context.createBufferSource();
      src.buffer = buffer;
      src.connect(context.destination);

      const duration = (buffer as { duration?: number }).duration ?? buffer.length / PLAYBACK_SR;
      const prev = playHeadRef.current.get(speakerId) ?? 0;
      const when = Math.max(prev, context.currentTime + PLAYBACK_PREBUFFER_S);
      src.start(when);
      playHeadRef.current.set(speakerId, when + duration);

      // 바지-인 정지 + 재생 완료 후 정리(누수 방지)를 위해 예약된 노드를 추적한다. Gemini가
      // 초당 여러 청크를 보내 노드가 계속 생기므로, 재생이 끝난 노드는 반드시 disconnect한다.
      let nodes = scheduledNodesRef.current.get(speakerId);
      if (!nodes) {
        nodes = new Set();
        scheduledNodesRef.current.set(speakerId, nodes);
      }
      nodes.add(src);
      // 재생이 끝날 시각(+여유 300ms)에 노드를 떼어낸다. one-shot 소스라 재생 후엔 소리를
      // 안 내지만, disconnect를 안 하면 네이티브 노드가 쌓여 장시간 미팅에서 누수가 된다.
      const cleanupDelayMs = (when + duration - context.currentTime) * 1000 + 300;
      setTimeout(() => {
        nodes!.delete(src);
        try {
          src.disconnect();
        } catch {
          // 이미 정리된 노드는 무시.
        }
      }, cleanupDelayMs);
    }

    // 바지-인(INTERRUPTED): 해당 화자의 예약된 미래 재생을 즉시 멈추고 playHead를 리셋해,
    // 다음 발화가 쿠션부터 새로 시작되게 한다. 다른 화자의 동시 재생은 건드리지 않는다.
    function stopSpeaker(speakerId: string) {
      const nodes = scheduledNodesRef.current.get(speakerId);
      if (nodes) {
        for (const node of nodes) {
          try {
            node.stop();
          } catch {
            // 이미 끝났거나 멈출 수 없는 노드는 무시.
          }
          try {
            node.disconnect();
          } catch {
            // no-op
          }
        }
        nodes.clear();
      }
      playHeadRef.current.delete(speakerId);
    }

    // 통역 오디오(AUDIO_TRANSLATED, 24kHz)와 bypass 원본(AUDIO_BYPASS, 16kHz)은 둘 다 raw
    // PCM(16-bit little-endian mono)이라 동일 경로로 동기 변환한 뒤 scheduleBuffer로 예약한다.
    function enqueuePcmBase64(speakerId: string, base64: string, sourceSR: number) {
      const context = audioContextRef.current;
      if (!context) return;
      const binary = globalThis.atob(base64);
      const byteLen = binary.length;
      if (byteLen < 2) return;
      const int16 = new Int16Array(byteLen >> 1);
      for (let i = 0; i < int16.length; i++) {
        int16[i] = (binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
      }
      let float32: Float32Array = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      // 재생 context는 PLAYBACK_SR(24kHz) 고정이라, 소스가 그와 다르면(bypass 16kHz) 미리
      // 리샘플링해 버퍼 선언 rate와 실제 재생 rate를 일치시킨다. 통역 오디오는 이미 24kHz라 통과.
      if (sourceSR !== PLAYBACK_SR) float32 = resample(float32, sourceSR, PLAYBACK_SR);
      if (float32.length === 0) return;
      const buffer = context.createBuffer(1, float32.length, PLAYBACK_SR);
      buffer.copyToChannel(float32, 0);
      scheduleBuffer(speakerId, buffer);
    }

    function handleSocketMessage(data: unknown) {
      // 모든 오디오가 이제 JSON(base64)으로 화자 식별자와 함께 오므로, 바이너리 프레임은
      // 더 이상 사용하지 않는다(과거 bypass 원본 PCM 경로는 AUDIO_BYPASS로 대체됨).
      if (typeof data !== 'string') return;
      let msg: LiveSessionEvent & Record<string, unknown>;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'AUDIO_TRANSLATED' && typeof msg.data === 'string') {
        enqueuePcmBase64(msg.speakerId as string, msg.data, PLAYBACK_SR); // 통역 오디오 24kHz
      } else if (msg.type === 'AUDIO_BYPASS' && typeof msg.data === 'string') {
        enqueuePcmBase64(msg.speakerId as string, msg.data, TARGET_SR); // 동일 언어 원본 16kHz
      } else if (msg.type === 'INTERRUPTED') {
        // 해당 화자의 예약 재생만 멈춘다 — 다른 화자의 동시 발화 재생은 끊지 않는다.
        stopSpeaker(msg.speakerId as string);
      }
      // 모든 JSON 이벤트(자막/상태/종료 등)는 RN 네이티브 UI로 그대로 전달.
      onEventRef.current(msg as LiveSessionEvent);
    }

    function openSocket(url: string, isReconnect = false) {
      if (!isReconnect) {
        intentionalCloseRef.current = false;
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
      }
      lastUrlRef.current = url;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // no-op
        }
      }
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        onStatusRef.current?.('ws-open');
      };
      ws.onmessage = (event) => handleSocketMessage(event.data);
      ws.onclose = (event) => {
        onStatusRef.current?.('ws-close');
        // 서버가 인증/참가자 등록 실패 등으로 명시적으로 거부한 연결(WS_1008_POLICY_VIOLATION,
        // app/routers/ws.py)은 재연결해도 다시 거부될 뿐이다 — 이걸 일시적 끊김과 똑같이
        // scheduleReconnect로 무한 재시도하면 참여자가 영원히 통역/자막을 못 받는데도
        // 화면엔 아무 에러도 안 뜨는 버그가 있었다(실제 리포트: 호스트 발화가 참여자
        // 화면에 전혀 안 보임). 1008은 재시도 없이 바로 에러로 알린다.
        if (event.code === 1008) {
          intentionalCloseRef.current = true;
          onStatusRef.current?.('error', 'ws_rejected');
          return;
        }
        scheduleReconnect();
      };
      ws.onerror = () => onStatusRef.current?.('error', 'ws_error');
    }

    async function connectSocket() {
      const token = await SecureStore.getItemAsync('access_token');
      const url = `${WS_URL}/ws/room/${roomId}?token=${encodeURIComponent(token ?? '')}`;
      openSocket(url);
    }

    useImperativeHandle(ref, () => ({
      startMic: () => {
        const result = recorderRef.current?.start();
        if (result && result.status === 'error') {
          onStatusRef.current?.('error', `mic:${result.message}`);
          return;
        }
        onStatusRef.current?.('mic-started');
      },
      stopMic: () => {
        recorderRef.current?.stop();
        onStatusRef.current?.('mic-stopped');
      },
      send: (payload) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(payload));
        }
      },
      close: () => {
        intentionalCloseRef.current = true;
        clearReconnectTimer();
        recorderRef.current?.stop();
        wsRef.current?.close();
        wsRef.current = null;
      },
    }));

    useEffect(() => {
      let cancelled = false;
      let context: AudioContext | null = null;
      let recorder: AudioRecorder | null = null;
      const scheduledNodes = scheduledNodesRef.current;
      const playHeads = playHeadRef.current;

      async function setup() {
        logCrashBreadcrumb(`live-audio-bridge: mount roomId=${roomId}`);

        // host-live-session(create-meeting 경로)은 join-meeting/guest-meeting-input과
        // 달리 진입 전에 마이크 권한을 요청하는 화면이 없었다 — 권한을 한 번도 안 받은
        // 채로 playAndRecord 세션을 활성화하면 iOS가 setActive 시점에 예외를 던질 수
        // 있다(2026-06-27 TestFlight 크래시, build 17). 세 화면이 공유하는 여기서 한 번
        // 더 요청해 안전망을 둔다 — 이미 허용된 경우 즉시 resolve되어 비용이 거의 없다.
        const permission = await AudioManager.requestRecordingPermissions();
        if (cancelled) return;
        logCrashBreadcrumb(`live-audio-bridge: mic permission=${permission}`);

        // iOS: 마이크 입력 + 스피커 출력을 동시에(playAndRecord) 쓰고, 블루투스 헤드셋도
        // 허용한다 — 코어 서비스가 "이어폰 끼고 실시간 통역"이라 라우팅이 핵심이다.
        // allowBluetoothA2DP(고음질 스트리밍 전용, 마이크 불가)와 allowBluetoothHFP(저음질
        // 핸즈프리, 마이크 가능)를 동시에 켜면 iOS가 setActive 시점에 NSError를 던지고
        // 그게 네이티브에서 그대로 재throw 돼 앱이 SIGABRT로 죽는다(실제 크래시 리포트로
        // 확인됨) — 마이크 캡처가 필수인 통역 서비스 특성상 HFP만 켠다.
        AudioManager.setAudioSessionOptions({
          iosCategory: 'playAndRecord',
          // voiceChat 모드는 iOS의 Voice-Processing I/O(하드웨어 AEC + 노이즈 억제)를
          // 켠다 — 같은 공간에서 옆 사람 목소리/스피커 누출이 내 마이크로 들어가는 걸
          // OS 레벨에서 1차로 줄여준다(클라이언트 RMS 게이팅과 2중 방어). 통역 서비스
          // 특성상 풀듀플렉스 음성 통신이라 이 모드가 정확히 들어맞는다.
          iosMode: 'voiceChat',
          iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
        });
        logCrashBreadcrumb('live-audio-bridge: setAudioSessionOptions done');

        // setAudioSessionActivity가 끝나기 전(세션이 실제로 active 상태가 되기 전)에
        // AudioContext/queue.start()로 오디오 그래프를 띄우면, 하드웨어 라우트 협상이
        // 아직 안 끝난 상태라 네이티브가 예외를 던지는 race condition이 있었다 — await로
        // 순서를 강제한다(2026-06-27 크래시: setAudioSessionOptions 다음 breadcrumb부터
        // queue ready 사이에서 죽었고, 둘 다 비동기 순서가 보장 안 되던 지점이었음).
        try {
          await AudioManager.setAudioSessionActivity(true);
        } catch (err) {
          logCrashBreadcrumb(`live-audio-bridge: setAudioSessionActivity failed ${(err as Error)?.message ?? 'unknown'}`);
        }
        if (cancelled) return;
        logCrashBreadcrumb('live-audio-bridge: setAudioSessionActivity done');

        context = new AudioContext({ sampleRate: PLAYBACK_SR });
        audioContextRef.current = context;
        logCrashBreadcrumb('live-audio-bridge: AudioContext created');
        // 재생은 화자별 playHead에 버퍼를 오디오 클럭으로 직접 예약한다(scheduleBuffer) —
        // 첫 오디오가 도착할 때 그 화자의 재생 상태가 lazy로 만들어진다(동시 발화 겹침 재생).

        recorder = new AudioRecorder();
        recorderRef.current = recorder;
        recorder.onAudioReady({ sampleRate: TARGET_SR, bufferLength: 2048, channelCount: 1 }, (event) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const channelData = event.buffer.getChannelData(0);
          if (channelData.length === 0) {
            // RangeError("offset must be a finite non-negative number: -1") 크래시 원인으로
            // 의심되는 경계 조건 — 빈 버퍼를 그대로 ws.send에 넘기면 네이티브 WS 브릿지가
            // 음수 offset을 계산해 던진다(2026-06-27 TestFlight 크래시 분석). 재현 시
            // Crashlytics에서 이 breadcrumb으로 확정할 수 있게 로그를 남기고 스킵한다.
            logCrashBreadcrumb('live-audio-bridge: empty channelData from recorder, skipping send');
            return;
          }
          const sourceSR = event.buffer.sampleRate || TARGET_SR;
          const resampled = sourceSR === TARGET_SR ? channelData : resample(channelData, sourceSR, TARGET_SR);
          if (resampled.length === 0) {
            logCrashBreadcrumb(`live-audio-bridge: resample produced empty buffer (sourceSR=${sourceSR})`);
            return;
          }
          // RMS 게이팅 + hangover: 임계값 이상이면 발화로 보고 hangover를 리셋한다. 임계값
          // 아래여도 직전에 발화가 있었으면(hangover 잔여) 말끝 감쇠 구간으로 보고 계속
          // 통과시킨다 — 이게 없으면 문장 끝 음량이 게이트 아래로 떨어지며 마지막 단어가
          // 잘려 통역/전사에서 누락된다. 발화도 hangover도 없는 순수 무음/누출 청크만 버린다.
          if (computeRms(resampled) >= MIC_RMS_GATE) {
            voiceHangoverRef.current = VOICE_HANGOVER_CHUNKS;
          } else if (voiceHangoverRef.current > 0) {
            voiceHangoverRef.current -= 1;
          } else {
            return;
          }
          // 상시 세션 + 동시 발화 모델에서는 통역/바이패스가 재생되는 중에도 마이크를 계속
          // 송신해야 한다 — 두번째 발화자는 정의상 남의 통역을 들으며 말을 시작하기 때문이다.
          // 과거 Hold & Flush(재생 중 마이크 버퍼링)는 "한 번에 한 명"인 floor-control 시절
          // 잔재라, 그 모델에선 두번째 화자의 오디오가 서버로 영영 안 올라가 통역이 안 됐다.
          // 스피커 누출은 iOS voiceChat AEC + 위 RMS 게이팅으로 막는다(CLAUDE.md 확정).
          ws.send(floatToInt16(resampled));
        });
        recorder.onError((err) => {
          logCrashBreadcrumb(`live-audio-bridge: recorder.onError ${err.message ?? 'unknown'}`);
          onStatusRef.current?.('error', `mic:${err.message ?? 'unknown'}`);
        });
        logCrashBreadcrumb('live-audio-bridge: AudioRecorder ready');

        onStatusRef.current?.('ready');
        connectSocket();
      }

      setup().catch((err) => {
        logCrashBreadcrumb(`live-audio-bridge: setup failed ${(err as Error)?.message ?? 'unknown'}`);
        onStatusRef.current?.('error', `setup:${(err as Error)?.message ?? 'unknown'}`);
      });

      return () => {
        cancelled = true;
        intentionalCloseRef.current = true;
        clearReconnectTimer();
        voiceHangoverRef.current = 0;
        recorder?.stop();
        recorder?.clearOnAudioReady();
        recorder?.clearOnError();
        wsRef.current?.close();
        wsRef.current = null;
        // 예약/재생 중인 모든 소스 노드를 정지·해제한다(화자 전체).
        for (const nodes of scheduledNodes.values()) {
          for (const node of nodes) {
            try {
              node.stop();
            } catch {
              // 이미 끝난 노드는 무시.
            }
            try {
              node.disconnect();
            } catch {
              // no-op
            }
          }
          nodes.clear();
        }
        scheduledNodes.clear();
        playHeads.clear();
        context?.close().catch(() => {});
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId]);

    return null;
  },
);

LiveAudioBridge.displayName = 'LiveAudioBridge';
