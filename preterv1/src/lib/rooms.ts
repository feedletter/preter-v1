import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class RoomsApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type CreateRoomPayload = {
  title?: string;
  password?: string;
  primary_language?: string;
  scheduled_at?: string;
};

export type CreateRoomResponse = {
  id: string;
  room_code: string;
  title: string | null;
  status: string;
  max_participants: number;
};

export async function createRoom(payload: CreateRoomPayload): Promise<CreateRoomResponse> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new RoomsApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    throw new RoomsApiError('CREATE_FAILED');
  }

  return response.json();
}
