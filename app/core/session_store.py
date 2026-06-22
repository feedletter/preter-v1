from app.core.gemini_session import GeminiLiveSession

# CLAUDE.md (가변 가정): MVP는 1:1 세션이라 Redis 없이 프로세스 메모리 dict로 충분.
# 멀티룸/멀티유저 확장 시 Cloud Memorystore(Redis) 도입 검토.
_sessions: dict[str, GeminiLiveSession] = {}


def register(session_id: str, session: GeminiLiveSession) -> None:
    _sessions[session_id] = session


def get(session_id: str) -> GeminiLiveSession | None:
    return _sessions.get(session_id)


def remove(session_id: str) -> None:
    _sessions.pop(session_id, None)
