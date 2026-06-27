import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type MeetingStatus = 'waiting' | 'active' | 'ended';

export type Meeting = {
  id: string;
  room_code: string;
  title: string | null;
  status: MeetingStatus;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  language: string;
  is_host: boolean;
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

// ---- After Meeting ---------------------------------------------------

export type MeetingNotesStatus = 'pending' | 'completed' | 'error';

export type SummaryContent = {
  one_liner: string;
  decisions: string[];
  action_items: { assignee: string; content: string; due: string }[];
  follow_up_schedule: { date: string; title: string; note: string }[];
};

export type MeetingSummary = {
  meeting_room_id: string;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  project_name: string | null;
  participants: string[];
  notes_status: MeetingNotesStatus;
  requester_preferred_language: string;
  summary: SummaryContent | null;
};

export async function fetchMeetingSummary(meetingRoomId: string): Promise<MeetingSummary> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/meetings/${meetingRoomId}/summary`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new MeetingsApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 404
            ? 'NOT_FOUND'
            : 'SERVER_ERROR';
    throw new MeetingsApiError(code);
  }

  return response.json();
}

export type SpeakerBlock = {
  id: string;
  speaker_user_id: string | null;
  speaker_name: string;
  country_code: string | null;
  original_language: string;
  original_text: string;
  translations: Record<string, string | null>;
  started_at: string;
  ended_at: string;
  sequence: number;
};

export type SpeakerBlocksPage = {
  meeting_room_id: string;
  requester_preferred_language: string;
  has_more: boolean;
  next_before_sequence: number | null;
  speaker_blocks: SpeakerBlock[];
};

export async function fetchSpeakerBlocks(
  meetingRoomId: string,
  beforeSequence?: number | null,
): Promise<SpeakerBlocksPage> {
  const accessToken = await SecureStore.getItemAsync('access_token');
  const params = new URLSearchParams();
  if (beforeSequence != null) {
    params.set('before_sequence', String(beforeSequence));
  }
  const query = params.toString();
  const url = `${API_URL}/api/v1/meetings/${meetingRoomId}/speaker-blocks${query ? `?${query}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new MeetingsApiError('NETWORK_ERROR');
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 404
            ? 'NOT_FOUND'
            : 'SERVER_ERROR';
    throw new MeetingsApiError(code);
  }

  return response.json();
}
