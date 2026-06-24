import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Document = {
  id: string;
  title: string;
  file_url: string;
  created_at: string;
};

export class DocumentsApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function fetchDocuments(): Promise<Document[]> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) throw new DocumentsApiError('FETCH_FAILED');
  const payload: { documents: Document[] } = await response.json();
  return payload.documents;
}

export async function uploadDocument(
  title: string,
  uri: string,
  filename: string,
  mimeType: string,
): Promise<Document> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  const formData = new FormData();
  formData.append('title', title);
  formData.append('file', { uri, name: filename, type: mimeType } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new DocumentsApiError(body?.detail?.error ?? 'UPLOAD_FAILED');
  }
  return response.json();
}
