import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const WS_URL = API_URL.replace(/^http/, 'ws');

// Host Live Session PRD 10.1/10.2 — 서버 ↔ 클라이언트 WebSocket 이벤트 명세.
export type RoomUser = {
  userId: string;
  displayName: string;
  language: string;
  role: 'host' | 'member' | 'guest';
  avatarUrl: string | null;
};

export type LiveSessionEvent =
  | {
      type: 'ROOM_STATE_UPDATE';
      users: RoomUser[];
      // 동시 발화 지원: 현재 말하고 있는 화자 집합(여럿일 수 있음).
      activeSpeakerIds: string[];
      // 구버전 호환용 단일 필드(첫 화자) — 신규 클라이언트는 activeSpeakerIds를 쓴다.
      activeSpeakerId: string | null;
      status: string;
      startedAt: string | null;
    }
  | { type: 'SUBTITLE_ORIGINAL'; speakerId: string; text: string; isFinal: boolean }
  | {
      type: 'SUBTITLE_TRANSLATED';
      speakerId: string;
      targetLanguage: string;
      text: string;
      isFinal: boolean;
    }
  | { type: 'AUDIO_TRANSLATED'; speakerId: string; targetLanguage: string; data: string }
  // 동일 언어 청자에게 통역 없이 그대로 보내는 원본 PCM(16kHz). 화자별 재생 큐로
  // 라우팅할 수 있게 speakerId를 함께 싣는다.
  | { type: 'AUDIO_BYPASS'; speakerId: string; data: string }
  | { type: 'TURN_COMPLETE'; speakerId: string }
  | { type: 'INTERRUPTED'; speakerId: string }
  | { type: 'ROOM_ENDED'; endedBy: string }
  | { type: 'PARTICIPANT_KICKED' };

type Listener = (event: LiveSessionEvent) => void;
type StatusListener = (status: 'connecting' | 'open' | 'closed') => void;

const PING_INTERVAL_MS = 30000;

export class LiveSessionSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  async connect(roomId: string): Promise<void> {
    const accessToken = await SecureStore.getItemAsync('access_token');
    const url = `${WS_URL}/ws/room/${roomId}?token=${encodeURIComponent(accessToken ?? '')}`;

    this.statusListeners.forEach((listener) => listener('connecting'));
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.statusListeners.forEach((listener) => listener('open'));
      this.pingTimer = setInterval(() => this.send({ type: 'PING' }), PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      // 오디오 바이너리 프레임(AUDIO_TRANSLATED 이전 버전 등)은 다음 단계(오디오 네이티브 모듈)에서 처리.
      if (typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as LiveSessionEvent;
        this.listeners.forEach((listener) => listener(payload));
      } catch {
        // 파싱 불가 메시지는 무시.
      }
    };

    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.statusListeners.forEach((listener) => listener('closed'));
    };
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** 오디오 네이티브 스트리밍 모듈 도입 전까지는 호출하지 않는다 (다음 단계). */
  sendAudioChunk(_chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(_chunk);
    }
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
    this.statusListeners.clear();
  }
}
