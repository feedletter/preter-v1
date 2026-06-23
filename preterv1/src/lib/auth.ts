import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

const API_URL = process.env.EXPO_PUBLIC_API_URL;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_ALREADY_EXISTS'
  | 'NETWORK_ERROR'
  | 'SNS_LOGIN_FAILED'
  | 'SNS_CANCELLED'
  | 'UNKNOWN';

export class AuthApiError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    plan: string | null;
    is_onboarded: boolean;
  };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const code = payload?.detail?.error ?? 'UNKNOWN';
    throw new AuthApiError(code, code);
  }

  return response.json();
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const result = await post<TokenResponse>('/api/v1/auth/login', { email, password });
  await storeTokens(result);
  return result;
}

export type SignupPayload = {
  primary_language: string;
  name: string;
  email: string;
  password: string;
  phone?: string;
  country_code?: string;
  company_email?: string;
  position?: string;
  company_name?: string;
};

export async function signup(payload: SignupPayload): Promise<TokenResponse> {
  const result = await post<TokenResponse>('/api/v1/auth/signup', payload);
  await storeTokens(result);
  return result;
}

export async function checkEmailAvailable(email: string): Promise<boolean> {
  const response = await fetch(
    `${API_URL}/api/v1/auth/check-email?email=${encodeURIComponent(email)}`,
  );
  if (!response.ok) {
    throw new AuthApiError('NETWORK_ERROR');
  }
  const payload: { available: boolean } = await response.json();
  return payload.available;
}

async function storeTokens(tokens: Pick<TokenResponse, 'access_token' | 'refresh_token'>) {
  // PRD 3.1.3: 토큰 저장 SecureStore (Expo) — access_token, refresh_token
  await SecureStore.setItemAsync('access_token', tokens.access_token);
  await SecureStore.setItemAsync('refresh_token', tokens.refresh_token);
}

function parseTokensFromRedirect(
  url: string,
): Pick<TokenResponse, 'access_token' | 'refresh_token'> | null {
  // Supabase OAuth는 콜백 URL의 #fragment에 토큰을 담아 보낸다 (...#access_token=...&refresh_token=...).
  const fragment = url.split('#')[1];
  if (!fragment) return null;

  const params: Record<string, string> = {};
  for (const pair of fragment.split('&')) {
    const [key, value] = pair.split('=');
    if (key) params[key] = decodeURIComponent(value ?? '');
  }

  if (!params.access_token || !params.refresh_token) return null;
  return { access_token: params.access_token, refresh_token: params.refresh_token };
}

export async function signInWithOAuth(
  provider: 'google' | 'apple',
): Promise<{ user: TokenResponse['user'] }> {
  // 네이티브 SDK 없이 Supabase의 표준 OAuth 웹 플로우를 그대로 쓴다 — 인앱 브라우저를 띄워
  // provider 로그인 후 Supabase가 토큰을 직접 발급해서 앱으로 돌려준다. Apple도 App Store
  // 가이드라인 4.8이 요구하는 "Sign in with Apple" 요건은 네이티브가 아니어도 충족된다.
  const redirectTo = Linking.createURL('auth-callback');
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);
  if (result.type !== 'success') {
    throw new AuthApiError('SNS_CANCELLED');
  }

  const tokens = parseTokensFromRedirect(result.url);
  if (!tokens) {
    throw new AuthApiError('SNS_LOGIN_FAILED', 'redirect URL에 토큰이 없음');
  }
  await storeTokens(tokens);

  return getMe(tokens.access_token);
}

export async function getMe(accessTokenOverride?: string): Promise<{ user: TokenResponse['user'] }> {
  const accessToken = accessTokenOverride ?? (await SecureStore.getItemAsync('access_token'));
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new AuthApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    throw new AuthApiError('UNKNOWN');
  }
  return response.json();
}

export async function completeSnsSignup(
  primaryLanguage: string,
  name: string,
): Promise<TokenResponse> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/auth/sns/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ primary_language: primaryLanguage, name }),
    });
  } catch {
    throw new AuthApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    throw new AuthApiError('UNKNOWN');
  }

  return response.json();
}
