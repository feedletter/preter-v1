import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  meeting_count: number;
};

export class ProjectsApiError extends Error {
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
    throw new ProjectsApiError('NETWORK_ERROR');
  }
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await authedFetch('/api/v1/projects');
  if (!response.ok) throw new ProjectsApiError('FETCH_FAILED');
  const payload: { projects: Project[] } = await response.json();
  return payload.projects;
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const response = await authedFetch('/api/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description || null }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProjectsApiError(body?.detail?.error ?? 'CREATE_FAILED');
  }
  return response.json();
}

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  document_count: number;
  has_instructions: boolean;
  instruction_content: string | null;
};

export type ProjectMeeting = {
  id: string;
  title: string | null;
  started_at: string | null;
  duration_min: number | null;
  project_id: string | null;
  project_name: string | null;
};

export async function fetchProjectDetail(projectId: string): Promise<ProjectDetail> {
  const response = await authedFetch(`/api/v1/projects/${projectId}`);
  if (!response.ok) throw new ProjectsApiError('FETCH_FAILED');
  return response.json();
}

export async function updateProjectName(projectId: string, name: string): Promise<Project> {
  const response = await authedFetch(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProjectsApiError(body?.detail?.error ?? 'UPDATE_FAILED');
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await authedFetch(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
  if (!response.ok) throw new ProjectsApiError('DELETE_FAILED');
}

export async function fetchProjectMeetings(projectId: string): Promise<ProjectMeeting[]> {
  const response = await authedFetch(`/api/v1/projects/${projectId}/meetings`);
  if (!response.ok) throw new ProjectsApiError('FETCH_FAILED');
  const payload: { meetings: ProjectMeeting[] } = await response.json();
  return payload.meetings;
}

export async function applyProjectDocument(projectId: string, documentId: string): Promise<void> {
  const response = await authedFetch(`/api/v1/projects/${projectId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProjectsApiError(body?.detail?.error ?? 'APPLY_FAILED');
  }
}

export async function saveProjectInstructions(projectId: string, content: string): Promise<void> {
  const response = await authedFetch(`/api/v1/projects/${projectId}/instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProjectsApiError(body?.detail?.error ?? 'SAVE_FAILED');
  }
}
