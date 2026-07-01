const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class BusinessCardApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type BusinessCardScanResult = {
  name: string | null;
  company_email: string | null;
  phone: string | null;
  company_name: string | null;
  position: string | null;
  confidence: number | null;
};

// Signup Card Intro 화면 — 가입 전(미인증)이라 Authorization 헤더 없이 호출한다.
export async function scanBusinessCard(photoUri: string): Promise<BusinessCardScanResult> {
  const formData = new FormData();
  // RN의 fetch는 { uri, name, type } 형태의 객체를 멀티파트 파일 파트로 인식한다.
  formData.append('file', { uri: photoUri, name: 'business-card.jpg', type: 'image/jpeg' } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/business-cards`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw new BusinessCardApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new BusinessCardApiError(body?.detail?.error ?? 'SCAN_FAILED');
  }
  return response.json();
}
