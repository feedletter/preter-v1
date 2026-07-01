import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Document = {
  id: string;
  title: string;
  file_url: string | null;
  created_at: string;
};

export type DocumentDetail = {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
  context_count: number;
};

export type DocumentMessage = {
  id: string;
  document_id: string;
  type: 'file' | 'text';
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  status: 'processing' | 'completed' | 'failed';
  analysis_result: Record<string, unknown> | null;
  created_at: string;
};

export type DocumentContext = {
  id: string;
  message_id: string | null;
  analysis_points: string[];
  technical_terms: string[] | null;
  language_hint: string | null;
  priority: string | null;
  created_at: string;
};

export class DocumentsApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  return { Authorization: `Bearer ${accessToken}` };
}

async function parseErrorOrThrow(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null);
  throw new DocumentsApiError(body?.detail?.error ?? fallback);
}

export async function fetchDocuments(): Promise<Document[]> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents`, { headers: await authHeader() });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) throw new DocumentsApiError('FETCH_FAILED');
  const payload: { documents: Document[] } = await response.json();
  return payload.documents;
}

// Doc Detail PRD Table 33 — 파일 없이 "제목없음" 빈 자료를 생성한다.
export async function createDocument(): Promise<Document> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents`, {
      method: 'POST',
      headers: await authHeader(),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'CREATE_FAILED');
  return response.json();
}

export async function fetchDocumentDetail(documentId: string): Promise<DocumentDetail> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}`, { headers: await authHeader() });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'FETCH_FAILED');
  return response.json();
}

export async function updateDocumentTitle(documentId: string, title: string): Promise<Document> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}`, {
      method: 'PATCH',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'UPDATE_FAILED');
  return response.json();
}

export async function deleteDocument(documentId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'DELETE_FAILED');
}

export async function fetchDocumentMessages(documentId: string): Promise<DocumentMessage[]> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}/messages`, {
      headers: await authHeader(),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'FETCH_FAILED');
  const payload: { messages: DocumentMessage[] } = await response.json();
  return payload.messages;
}

export async function sendTextMessage(documentId: string, content: string): Promise<DocumentMessage> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}/messages/text`, {
      method: 'POST',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'SEND_FAILED');
  return response.json();
}

export async function sendFileMessage(
  documentId: string,
  uri: string,
  filename: string,
  mimeType: string,
): Promise<DocumentMessage> {
  const formData = new FormData();
  formData.append('file', { uri, name: filename, type: mimeType } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}/messages`, {
      method: 'POST',
      headers: await authHeader(),
      body: formData,
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'SEND_FAILED');
  return response.json();
}

export async function pollMessageStatus(
  documentId: string,
  messageId: string,
): Promise<Pick<DocumentMessage, 'id' | 'status' | 'analysis_result'>> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}/messages/${messageId}/status`, {
      headers: await authHeader(),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'FETCH_FAILED');
  return response.json();
}

export async function fetchDocumentContext(documentId: string): Promise<DocumentContext[]> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/documents/${documentId}/context`, {
      headers: await authHeader(),
    });
  } catch {
    throw new DocumentsApiError('NETWORK_ERROR');
  }
  if (!response.ok) await parseErrorOrThrow(response, 'FETCH_FAILED');
  const payload: { contexts: DocumentContext[] } = await response.json();
  return payload.contexts;
}
