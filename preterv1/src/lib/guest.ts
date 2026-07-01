import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type GuestErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_ENDED'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'ROOM_NOT_STARTED'
  | 'WRONG_PASSWORD'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class GuestApiError extends Error {
  code: GuestErrorCode;
  detail: Record<string, unknown>;

  constructor(code: GuestErrorCode, detail: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export type ValidateRoomResponse = {
  valid: boolean;
  has_password: boolean;
  status: string;
  scheduled_at: string | null;
  participant_count: number;
  max_participants: number;
};

export type JoinResponse = {
  guest_session_token: string;
  room_id: string;
  room_title: string | null;
  participants: number;
  expires_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new GuestApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const code = (payload?.detail?.error ?? 'UNKNOWN') as GuestErrorCode;
    throw new GuestApiError(code, payload?.detail ?? {});
  }

  return response.json();
}

export async function validateRoom(roomCode: string): Promise<ValidateRoomResponse> {
  return request<ValidateRoomResponse>(`/api/v1/rooms/${roomCode}/validate`);
}

export type JoinPayload = {
  room_code: string;
  display_name: string;
  password?: string;
  email?: string;
  language?: string;
  audio_enabled?: boolean;
};

export async function joinRoom(payload: JoinPayload): Promise<JoinResponse> {
  const result = await request<JoinResponse>('/api/v1/guest/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await SecureStore.setItemAsync('guest_session_token', result.guest_session_token);
  await SecureStore.setItemAsync('guest_room_id', result.room_id);
  return result;
}

export async function leaveRoom(): Promise<void> {
  const token = await SecureStore.getItemAsync('guest_session_token');
  if (!token) return;
  await request('/api/v1/guest/leave', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  await SecureStore.deleteItemAsync('guest_session_token');
  await SecureStore.deleteItemAsync('guest_room_id');
}
