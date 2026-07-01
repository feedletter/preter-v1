# Preter — 프로젝트 컨텍스트

실시간 AI 동시통역 서비스. 한국 중소기업 수출 담당자가 해외 바이어와 미팅할 때
이어폰을 끼고 각자 모국어로 말하면 실시간으로 통역되어 들리는 구조.

**코어 서비스 한 줄 정의 (절대 잊지 말 것):** 마이크로 말하면 그게 실시간으로
통역되어 다른 사람 귀에 들리는 것. 화면/상태머신/참가자 관리 등은 모두 이 핵심
경험을 보조하는 장치일 뿐이고, 이게 안 되면 제품이 작동하지 않는 것과 같다.

이 문서는 Claude Code가 매 세션 자동으로 읽는 컨텍스트다.
코드를 작성하기 전에 아래 "확정 사항"은 그대로 따르고,
"가변 가정"은 현재 단계(MVP)에서의 판단이지 영구 제약이 아님을 인지할 것.

---

## 확정 사항 (변경 시 반드시 Jay 확인)

### 기술 스택
- 프론트엔드: React Native (Expo) — EAS Update로 OTA 배포
- 백엔드: FastAPI (Python, asyncio 기반)
- AI: Google Gemini Live API, `google-genai` Python SDK (Bidi WebSocket)
- DB: Supabase (PostgreSQL + pgvector), 리전 ap-northeast-2 (서울)
- 파일 저장: GCP Cloud Storage
- 컴퓨팅: GCP Cloud Run, 리전 asia-northeast3 (서울)
- DNS/SSL: Cloudflare 무료 플랜

### 리전 선택 이유 (근거 있음 — 임의 변경 금지)
Gemini Live API가 Google 인프라에서 동작하므로, FastAPI 서버를 GCP 서울 리전에 두면
Gemini API 호출이 퍼블릭 인터넷을 거치지 않고 Google 내부망을 경유한다.
실시간 오디오 스트리밍에서 이 레이턴시 차이가 통역 자연스러움에 직결됨.
Supabase도 같은 이유로 서울 리전(ap-northeast-2) 사용.

### Cloud Run 배포 설정 (MVP 단계 고정값)
- `--timeout=3600` (60분, 하드 리밋)
- `--max-instances=1`, `--min-instances=1`
  → 이유: Cloud Run은 무상태 컨테이너라 스케일링/콜드스타트 시 프로세스 메모리(dict)의
    세션 데이터가 날아감. MVP는 미팅룸 단위 세션(룸당 최대 4인)이라 인스턴스를 1개로
    고정해 메모리 파편화를 막음. (유휴 비용 월 수 달러 발생하지만 안정성과 트레이드오프)
- CPU는 "항상 할당" 모드로 설정 (요청 처리 중에만 할당하는 기본값 사용 금지)
  → WebSocket이 계속 열려있는데 기본 모드면 CPU가 유휴화되어 오디오 끊김 발생

### 미팅룸 멀티파티 아키텍처 (1:1 가정 폐기 — 단순화 금지)
- **1:1 전용이라는 과거 가정은 폐기됨.** 미팅룸 하나에 호스트 포함 **최대 4인**까지
  동시 참여 가능 (`app/core/room_state.py`의 `RoomState`/`RoomManager`가 룸 단위로 관리).
- **[2026-07-01 전환] Floor control 폐기 → 큐 기반 상시 세션 모델.** 과거엔 먼저 말한
  사람이 발화 턴을 독점하고(floor control) 3초 무음 watchdog으로 턴을 마감했는데,
  (1) watchdog이 이벤트 루프 부하/타이밍에 따라 턴을 못 닫는 버그가 있었고 (2) 동시
  발화가 통째로 드롭돼 부자연스러웠다. 이제 **서버가 발화 턴을 관리하지 않는다**:
  - 참가자 입장 시점에 각 화자별로, 그와 "다른 언어"를 쓰는 청자 언어 종류마다 Gemini
    Live 세션을 1개씩 **상시 오픈**해 둔다(`SpeakerStream`). 오디오는 들어오는 대로
    그냥 열린 세션에 흘려보내고, 발화 구간 감지(VAD)는 Gemini Live가 내부적으로 한다.
  - 같은 언어 청자에게는 원본 PCM을 그대로 bypass(`AUDIO_BYPASS`, speakerId 포함).
  - 여러 명이 동시에 말하면 각자의 세션이 동시에 통역을 내보내고, 클라이언트는 화자별
    재생 큐(`AudioBufferQueueSourceNode` per speakerId)로 받아 자연스럽게 겹쳐 재생한다.
  - Gemini의 `turn_complete`는 세션을 닫는 신호가 아니라 "발화 블록 1개 종료" 경계로만
    쓴다(자막 확정 + speaker_blocks 적재 + 누적 텍스트 리셋). 세션은 안 닫는다.
- **세션 수·비용**: 상시 모델은 최악의 경우(4인 전부 다른 언어) 미팅 내내 화자별 N-1개씩
  최대 **N×(N-1)=12개** 세션이 동시에 열려 있다. 단, **Gemini Live 과금은 연결 시간이
  아니라 실제 처리 오디오량 기준**(Jay 확인, 2026-07-01)이라, 무음 구간엔 청크를 안 보내면
  비용이 거의 늘지 않는다 — 이 전제 위에서 상시 세션을 채택했다. 무음 청크를 안 보내는
  1차 장치가 클라이언트 **RMS 에너지 게이팅**(`live-audio-bridge.tsx`).
  → 향후 룸 인원을 늘리면 동시 세션 수가 N×(N-1)로 제곱에 가깝게 늘고, 과금 전제(처리량
    기반)가 바뀌면 비용도 급증하므로 반드시 재검토할 것.
- **음성 누출(bleed-through) 방어**: 같은 공간에서 옆 사람 목소리가 내 마이크로 새어 들어가
  내 발화 세션이 옆 사람 말을 통역해버리는 문제는 (1) iOS `voiceChat` 모드 하드웨어 AEC
  (2) 클라이언트 RMS 게이팅 2중으로 막는다. 주파수 기반 화자 분리는 사람 목소리 대역이
  모두 동일(80Hz~8kHz)해서 불가능 — 채택하지 않음.
- 원문 자막(SUBTITLE_ORIGINAL)은 별도 세션 없이, 화자의 통역 세션 중 하나(primary)의
  `input_audio_transcription` 결과를 그대로 재사용한다 (중복 적재 방지 핵심 트릭).

### Docker 빌드
- 항상 `docker build --platform linux/amd64` 로 빌드 (Cloud Run은 x86_64)
- 로컬 칩(Intel/M2/M4)과 무관하게 이 플래그 고정
- `requirements.txt`는 `pip freeze`로 버전 고정해서 커밋

### Gemini Live API 세션 관리 (핵심 인프라, 단순화 금지)
- Gemini WebSocket 연결 자체는 약 10분마다 끊김 → Session Resumption으로 핸들 갱신
- Cloud Run 타임아웃은 60분 → 55분 경과 시점에 클라이언트가 선제적으로 새 WebSocket 연결 수립,
  Supabase에서 세션 컨텍스트 복원
- GoAway 알림: Gemini가 60초 전 사전 경고 발송 → FastAPI가 감지해서 재연결 트리거
- Context Window Compression: 토큰 사용량 80,000 도달 시 자동 트리거 (초반 발화 요약 처리)

### RAG / 컨텍스트 주입 방식 (레이턴시 때문에 일반적 RAG 패턴과 다름)
- 미팅 자료(영업자료, 카탈로그)는 세션 시작 시 **한 번에** 긴 컨텍스트로 system_instruction에 주입
  (Gemini의 긴 컨텍스트 윈도우를 활용 — 수십만 자도 RAG 없이 처리 가능)
- 실시간 발화 중에는 pgvector 벡터 서치를 **호출하지 않음** (동기 지연 유발 위험)
- 대신 FastAPI 메모리에 캐싱해둔 키워드 단어장(고정 단어 매핑)으로 가볍게 처리
- pgvector는 세션 시작 전 사전 임베딩/검색 용도로만 사용

### 인증
- JWT 또는 Firebase Auth ID 토큰, FastAPI 비동기 미들웨어에서 검증
- Supabase RLS(Row Level Security)로 유저별 데이터 격리는 DB 레벨에서 처리

---

## 가변 가정 (MVP 단계 판단 — 확장 시 재검토 대상)

- 세션 캐시: Redis 미사용, FastAPI 프로세스 메모리(dict)로 충분
  → 멀티룸 확장(여러 미팅룸 동시 운영) 시점에 Cloud Memorystore(Redis) 도입 예정
  → 즉, "Redis 안 씀"은 영구 결정이 아니라 단일 인스턴스 MVP 한정 판단임
- MVP 스코프: 미팅룸당 **최대 4인** (호스트 포함) — 5인 이상 다자간은 추후 검토
  (위 "미팅룸 멀티파티 아키텍처" 참조 — 인원 늘리면 N-1 세션 팬아웃 비용도 같이 늘어남)
- 지원 언어: KO↔EN↔JA↔ZH (Gemini Live API에는 `zh`가 아니라 `zh-Hans`로 매핑해서 전달 —
  `app/core/gemini_session.py`의 `to_gemini_language_code` 참조)

---

## 인수인계 / 협업 환경 메모

- Jay 현재 개발 환경: Intel Mac (x86_64) — Cloud Run과 아키텍처 일치
- 향후 합류 예정 개발자(CTO): M4 Mac (ARM64)
- 코드 자체(Python/FastAPI/RN)는 아키텍처 무관, 호환 문제 없음
- 신경 쓸 지점은 Docker 빌드 플랫폼 고정과 requirements.txt 버전 고정 두 가지뿐
- 권장 레포 구조:
  ```
  preter/
  ├── Dockerfile                  # --platform linux/amd64 고정
  ├── requirements.txt            # pip freeze 버전 고정
  ├── .env.example                # 환경변수 템플릿 (실제 키 제외)
  └── README.md                   # 로컬 실행 방법
  ```

---

## 코딩 스타일 / 작업 방식 참고

- 엔진(Gemini Live API)은 교체 가능한 commodity로 취급 — 비즈니스 로직과 강결합 금지
- 진짜 차별점은 컨텍스트 주입(RAG)과 UX이므로, 이 레이어는 다른 부분보다 신경 써서 설계
- 코드 작성 시 "왜 이 설정값인가"를 주석으로 남길 것 (특히 Cloud Run 설정, 타임아웃 값들은
  숫자만 보면 임의로 보이기 쉬움 — 위 "확정 사항"의 근거를 주석에 반영)
