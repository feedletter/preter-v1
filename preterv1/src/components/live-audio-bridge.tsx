import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AudioBufferQueueSourceNode,
} from 'react-native-audio-api';

import { logCrashBreadcrumb } from '@/lib/firebase';
import type { LiveSessionEvent } from '@/lib/live-session';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const WS_URL = API_URL.replace(/^http/, 'ws');
const TARGET_SR: number = 16000; // Gemini Live 입력 규격
// Gemini Live가 돌려주는 통역 오디오는 24kHz 고정 규격(공식 스펙) — 재생용 AudioContext를
// 이 값으로 고정한다. new AudioContext()를 옵션 없이 만들면 기기 하드웨어 네이티브
// sample rate(44100/48000 등 기기마다 다름)로 잡히는데, react-native-audio-api의
// AudioBufferQueueSourceNode가 버퍼 자체의 sampleRate와 context의 실제 출력 sampleRate가
// 다를 때 자동 리샘플링을 보장하지 않아 "다른 기기에서는 정상, 어떤 기기에서는 빠르거나
// 느리게 들리는" 간헐적 버그의 원인이 된다(2026-06-28 발견). context를 고정값으로
// 만들어 기기 하드웨어 native rate에 대한 의존을 완전히 없앤다.
const PLAYBACK_SR = 24000;
const MAX_RECONNECT_DELAY_MS = 10000;

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
    const queueRef = useRef<AudioBufferQueueSourceNode | null>(null);
    const recorderRef = useRef<AudioRecorder | null>(null);

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

    function playBypassPCM(arrayBuffer: ArrayBuffer) {
      const context = audioContextRef.current;
      const queue = queueRef.current;
      if (!context || !queue) return;
      const int16 = new Int16Array(arrayBuffer);
      if (int16.length === 0) return;
      let float32: Float32Array = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      // bypass 원본은 16kHz로 들어오는데 재생 context는 PLAYBACK_SR(24kHz) 고정이라
      // 그대로 createBuffer에 16000을 선언해버리면 큐 안에서 통역 오디오(24kHz 선언)와
      // 섞일 때 노드가 buffer.sampleRate를 무시하고 context rate로만 재생해 1.5배 빠르게
      // 들린다 — 미리 PLAYBACK_SR로 리샘플링해서 버퍼에 선언하는 rate와 실제 재생 rate를
      // 항상 일치시킨다.
      if (TARGET_SR !== PLAYBACK_SR) float32 = resample(float32, TARGET_SR, PLAYBACK_SR);
      if (float32.length === 0) return;
      const buffer = context.createBuffer(1, float32.length, PLAYBACK_SR);
      buffer.copyToChannel(float32, 0);
      queue.enqueueBuffer(buffer);
    }

    function playTranslatedBase64(base64: string) {
      const context = audioContextRef.current;
      const queue = queueRef.current;
      if (!context || !queue) return;
      context
        .decodePCMInBase64(base64, PLAYBACK_SR, 1, false)
        .then((buffer) => queue.enqueueBuffer(buffer))
        .catch(() => {
          // 디코딩 실패한 통역 오디오 조각 1개는 그냥 버린다 — 세션 전체를 끊을 정도는 아님.
        });
    }

    function handleSocketMessage(data: unknown) {
      if (data instanceof ArrayBuffer) {
        // 같은 언어 bypass 원본 PCM (16kHz).
        playBypassPCM(data);
        return;
      }
      if (typeof data !== 'string') return;
      let msg: LiveSessionEvent & Record<string, unknown>;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'AUDIO_TRANSLATED' && typeof msg.data === 'string') {
        playTranslatedBase64(msg.data); // 통역 오디오 24kHz
      } else if (msg.type === 'INTERRUPTED') {
        queueRef.current?.clearBuffers();
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
      let queue: AudioBufferQueueSourceNode | null = null;
      let recorder: AudioRecorder | null = null;

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

        queue = context.createBufferQueueSource();
        queue.connect(context.destination);
        logCrashBreadcrumb('live-audio-bridge: queue connected');
        // react-native-audio-api의 AudioBufferQueueSourceNode.start()는 offset 기본값이
        // -1인데 곧바로 "offset < 0이면 RangeError" 검증을 하는 라이브러리 자체 버그가
        // 있다 — 인자 없이 호출하면 항상 100% 크래시한다(2026-06-27 TestFlight 확정).
        // 명시적으로 offset=0을 넘겨서 그 기본값을 우회한다.
        queue.start(0, 0);
        queueRef.current = queue;
        logCrashBreadcrumb('live-audio-bridge: queue started');

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
        recorder?.stop();
        recorder?.clearOnAudioReady();
        recorder?.clearOnError();
        wsRef.current?.close();
        wsRef.current = null;
        queue?.stop();
        context?.close().catch(() => {});
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId]);

    return null;
  },
);

LiveAudioBridge.displayName = 'LiveAudioBridge';
