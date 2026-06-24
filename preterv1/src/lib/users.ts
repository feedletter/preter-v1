import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class UsersApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type MyProfile = {
  id: string;
  name: string | null;
  email: string | null;
  primary_language: string;
  app_language: string;
  avatar_url: string | null;
  updated_at: string;
};

export type MyPlan = {
  plan: string;
  status: string;
  minutes_used: number;
  minutes_total: number;
  period_start: string;
  period_end: string;
};

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new UsersApiError('NETWORK_ERROR');
  }
}

export async function getMyProfile(): Promise<MyProfile> {
  const response = await authedFetch('/api/v1/users/me');
  if (!response.ok) throw new UsersApiError('FETCH_FAILED');
  return response.json();
}

export async function updateMyProfile(
  payload: Partial<Pick<MyProfile, 'name' | 'primary_language' | 'app_language'>>,
): Promise<MyProfile> {
  const response = await authedFetch('/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new UsersApiError(body?.detail?.error ?? 'UPDATE_FAILED');
  }
  return response.json();
}

export async function getMyPlan(): Promise<MyPlan> {
  const response = await authedFetch('/api/v1/users/me/plan');
  if (!response.ok) throw new UsersApiError('FETCH_FAILED');
  return response.json();
}

export async function uploadMyAvatar(uri: string, mimeType: string): Promise<MyProfile> {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const formData = new FormData();
  // RN의 fetch는 { uri, name, type } 형태의 객체를 멀티파트 파일 파트로 인식한다.
  formData.append('file', { uri, name: `avatar.${extension}`, type: mimeType } as unknown as Blob);

  const response = await authedFetch('/api/v1/users/me/avatar', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new UsersApiError(body?.detail?.error ?? 'UPLOAD_FAILED');
  }
  return response.json();
}

export async function deleteMyAvatar(): Promise<MyProfile> {
  const response = await authedFetch('/api/v1/users/me/avatar', { method: 'DELETE' });
  if (!response.ok) throw new UsersApiError('DELETE_FAILED');
  return response.json();
}
