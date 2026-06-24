import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type MeetingStatus = 'waiting' | 'active' | 'ended';

export type Meeting = {
  id: string;
  title: string | null;
  status: MeetingStatus;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  language: string;
  project_id: string | null;
  project_name: string | null;
};

export class MeetingsApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function fetchUpcomingMeetings(): Promise<Meeting[]> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/meetings/upcoming`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new MeetingsApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const code = response.status === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR';
    throw new MeetingsApiError(code);
  }

  const payload: { meetings: Meeting[]; total: number } = await response.json();
  return payload.meetings;
}

export type RecentMeeting = {
  id: string;
  title: string | null;
  started_at: string | null;
  duration_min: number | null;
  project_id: string | null;
  project_name: string | null;
};

export async function fetchRecentMeetings(): Promise<RecentMeeting[]> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/meetings/recent`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new MeetingsApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const code = response.status === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR';
    throw new MeetingsApiError(code);
  }

  const payload: { meetings: RecentMeeting[] } = await response.json();
  return payload.meetings;
}
