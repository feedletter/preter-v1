import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class RoomsApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new RoomsApiError('NETWORK_ERROR');
  }
}

export type DraftRoom = {
  id: string;
  room_code: string;
  status: string;
};

export async function createDraftRoom(): Promise<DraftRoom> {
  const response = await authedFetch('/api/v1/rooms/draft', { method: 'POST' });
  if (!response.ok) throw new RoomsApiError('DRAFT_FAILED');
  return response.json();
}

export async function cancelDraftRoom(roomId: string): Promise<void> {
  await authedFetch(`/api/v1/rooms/draft/${roomId}`, { method: 'DELETE' });
}

export type ConfirmRoomPayload = {
  draft_id: string;
  title: string;
  scheduled_at: string;
  project_id?: string | null;
  document_id?: string | null;
  password?: string;
};

export type ConfirmRoomResponse = {
  id: string;
  room_code: string;
  title: string;
  scheduled_at: string;
  status: string;
  project_id: string | null;
  document_id: string | null;
};

export async function createRoom(payload: ConfirmRoomPayload): Promise<ConfirmRoomResponse> {
  const response = await authedFetch('/api/v1/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RoomsApiError(body?.detail?.error ?? 'CREATE_FAILED');
  }
  return response.json();
}

export type StartRoomResponse = {
  id: string;
  room_code: string;
  title: string | null;
  status: string;
  max_participants: number;
};

export async function startRoom(roomId: string): Promise<StartRoomResponse> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}/start`, { method: 'PATCH' });
  if (!response.ok) throw new RoomsApiError('START_FAILED');
  return response.json();
}

export async function endRoom(roomId: string): Promise<void> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}/end`, { method: 'DELETE' });
  if (!response.ok) throw new RoomsApiError('END_FAILED');
}

export type RoomDetail = {
  id: string;
  room_code: string;
  title: string | null;
  password: string | null;
  status: string;
  max_participants: number;
};

export async function fetchRoomDetail(roomId: string): Promise<RoomDetail> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}`);
  if (!response.ok) throw new RoomsApiError('ROOM_FETCH_FAILED');
  return response.json();
}

export type RoomParticipant = {
  id: string;
  user_id: string | null;
  guest_session_id: string | null;
  display_name: string;
  role: 'host' | 'member' | 'guest';
  language: string;
  audio_enabled: boolean;
  joined_at: string;
  left_at: string | null;
  is_kicked: boolean;
};

export async function fetchRoomParticipants(roomId: string): Promise<RoomParticipant[]> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}/participants`);
  if (!response.ok) throw new RoomsApiError('PARTICIPANTS_FETCH_FAILED');
  return response.json();
}

export async function kickParticipant(roomId: string, participantId: string): Promise<void> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}/participants/${participantId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new RoomsApiError('KICK_FAILED');
}

// Member Join MeetingRoom PRD 6.1 — 로그인 멤버용 코드 검증/참가 (Bearer AT 필요).
export type ValidateRoomMemberResponse = {
  valid: boolean;
  room_id: string;
  title: string | null;
  has_password: boolean;
  status: string;
  scheduled_at: string | null;
  participant_count: number;
  max_participants: number;
};

export async function validateRoomMember(code: string): Promise<ValidateRoomMemberResponse> {
  const response = await authedFetch(`/api/v1/rooms/${code}/validate`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RoomsApiError(body?.detail?.error ?? 'VALIDATE_FAILED');
  }
  return response.json();
}

export type MemberJoinPayload = {
  project_id?: string | null;
  document_id?: string | null;
  password?: string;
  audio_enabled: boolean;
};

export type MemberJoinResponse = {
  status: 'waiting' | 'active';
  room_id: string;
  title: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
};

export async function joinRoomMember(code: string, payload: MemberJoinPayload): Promise<MemberJoinResponse> {
  const response = await authedFetch(`/api/v1/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RoomsApiError(body?.detail?.error ?? 'JOIN_FAILED');
  }
  return response.json();
}

export async function registerParticipant(
  roomId: string,
  payload: { role?: string; language: string; audio_enabled: boolean },
): Promise<{ id: string }> {
  const response = await authedFetch(`/api/v1/rooms/${roomId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new RoomsApiError('REGISTER_PARTICIPANT_FAILED');
  return response.json();
}

export async function leaveRoomAsMember(roomId: string): Promise<void> {
  await authedFetch(`/api/v1/rooms/${roomId}/leave`, { method: 'POST' });
}
