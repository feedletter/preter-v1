"""테이블별 어드민 화면 정의.

새 테이블이 추가되면: app/admin/models.py에 모델 추가 → 여기에 ModelView 하나
추가 → app/admin/__init__.py의 setup_admin()에서 admin.add_view() 한 줄.
그게 끝이다. 디자인이나 프론트엔드 작업이 필요 없다.
"""

from sqladmin import ModelView

from app.admin.models import (
    BusinessCard,
    Document,
    DocumentContext,
    DocumentMessage,
    GuestSession,
    MeetingParticipant,
    MeetingRoom,
    MeetingSummary,
    OAuthProvider,
    Project,
    ProjectDocument,
    ProjectInstruction,
    Report,
    User,
    UserPlan,
)


class UserAdmin(ModelView, model=User):
    name = "유저"
    name_plural = "유저"
    icon = "fa-solid fa-user"
    category = "회원"

    column_list = [
        User.id,
        User.name,
        User.email,
        User.primary_language,
        User.signup_method,
        User.is_onboarded,
        User.is_admin,
        User.created_at,
    ]
    column_searchable_list = [User.name, User.email]
    column_sortable_list = [User.created_at, User.name]
    column_default_sort = [(User.created_at, True)]
    form_excluded_columns = [User.plan, User.oauth_providers]
    can_create = False  # 가입은 앱에서만, 어드민에선 생성 안 함
    can_delete = True


class UserPlanAdmin(ModelView, model=UserPlan):
    name = "플랜"
    name_plural = "플랜/구독"
    icon = "fa-solid fa-credit-card"
    category = "회원"

    column_list = [
        UserPlan.user,
        UserPlan.plan,
        UserPlan.status,
        UserPlan.minutes_used,
        UserPlan.minutes_total,
        UserPlan.period_start,
        UserPlan.period_end,
    ]
    column_sortable_list = [UserPlan.period_end, UserPlan.minutes_used]
    can_create = False


class BusinessCardAdmin(ModelView, model=BusinessCard):
    name = "명함 스캔"
    name_plural = "명함 스캔 기록"
    icon = "fa-solid fa-id-card"
    category = "회원가입"

    column_list = [
        BusinessCard.name,
        BusinessCard.company_name,
        BusinessCard.ocr_provider,
        BusinessCard.confidence,
        BusinessCard.expires_at,
        BusinessCard.created_at,
    ]
    column_sortable_list = [BusinessCard.created_at, BusinessCard.expires_at]
    can_create = False
    can_edit = False


class OAuthProviderAdmin(ModelView, model=OAuthProvider):
    name = "SNS 연동"
    name_plural = "SNS 연동 계정"
    icon = "fa-brands fa-google"
    category = "회원가입"

    column_list = [
        OAuthProvider.user,
        OAuthProvider.provider,
        OAuthProvider.email,
        OAuthProvider.created_at,
    ]
    # 토큰 값은 운영자도 화면에서 노출하지 않음 (탈취 위험 — 별도 암호화 작업 전까지는 더더욱)
    column_details_exclude_list = [OAuthProvider.access_token, OAuthProvider.refresh_token]
    can_create = False


class ProjectAdmin(ModelView, model=Project):
    name = "프로젝트"
    name_plural = "프로젝트"
    icon = "fa-solid fa-folder"
    category = "미팅/자료"

    column_list = [
        Project.name,
        Project.description,
        Project.user,
        Project.created_at,
        Project.deleted_at,
    ]
    # 운영 케이스 4: 프로젝트 상세에서 등록된 미팅/자료/지시사항을 한 화면에서 확인.
    column_details_list = [
        Project.id,
        Project.name,
        Project.description,
        Project.user,
        Project.meeting_rooms,
        Project.project_documents,
        Project.instruction,
        Project.created_at,
        Project.deleted_at,
    ]
    column_searchable_list = [Project.name]
    column_sortable_list = [Project.created_at]
    column_default_sort = [(Project.created_at, True)]
    can_create = True


class DocumentAdmin(ModelView, model=Document):
    name = "미팅 자료"
    name_plural = "미팅 자료"
    icon = "fa-solid fa-file"
    category = "미팅/자료"

    column_list = [
        Document.title,
        Document.user,
        Document.file_url,
        Document.created_at,
        Document.deleted_at,
    ]
    # 운영 케이스 5: 자료 상세에서 메시지/통역 맥락/연결된 프로젝트·미팅을 한 화면에서 확인.
    column_details_list = [
        Document.id,
        Document.title,
        Document.user,
        Document.file_url,
        Document.messages,
        Document.contexts,
        Document.project_documents,
        Document.meeting_rooms,
        Document.created_at,
        Document.deleted_at,
    ]
    column_searchable_list = [Document.title]
    column_sortable_list = [Document.created_at]
    column_default_sort = [(Document.created_at, True)]
    can_create = True


class DocumentMessageAdmin(ModelView, model=DocumentMessage):
    name = "자료 메시지"
    name_plural = "자료 메시지"
    icon = "fa-solid fa-comment-dots"
    category = "미팅/자료"

    column_list = [
        DocumentMessage.document,
        DocumentMessage.type,
        DocumentMessage.status,
        DocumentMessage.file_name,
        DocumentMessage.created_at,
    ]
    column_searchable_list = [DocumentMessage.file_name, DocumentMessage.content]
    column_sortable_list = [DocumentMessage.created_at]
    column_default_sort = [(DocumentMessage.created_at, True)]
    column_filters = [DocumentMessage.status, DocumentMessage.type]
    can_create = True


class DocumentContextAdmin(ModelView, model=DocumentContext):
    name = "통역 맥락"
    name_plural = "통역 맥락"
    icon = "fa-solid fa-brain"
    category = "미팅/자료"

    column_list = [
        DocumentContext.document,
        DocumentContext.language_hint,
        DocumentContext.priority,
        DocumentContext.created_at,
    ]
    column_sortable_list = [DocumentContext.created_at]
    column_default_sort = [(DocumentContext.created_at, True)]
    column_filters = [DocumentContext.language_hint, DocumentContext.priority]
    can_create = True


class ProjectDocumentAdmin(ModelView, model=ProjectDocument):
    name = "프로젝트 자료 연결"
    name_plural = "프로젝트 자료 연결"
    icon = "fa-solid fa-link"
    category = "미팅/자료"

    column_list = [
        ProjectDocument.project,
        ProjectDocument.document,
        ProjectDocument.applied_at,
    ]
    column_sortable_list = [ProjectDocument.applied_at]
    can_create = True


class ProjectInstructionAdmin(ModelView, model=ProjectInstruction):
    name = "프로젝트 지시사항"
    name_plural = "프로젝트 지시사항"
    icon = "fa-solid fa-note-sticky"
    category = "미팅/자료"

    column_list = [
        ProjectInstruction.project,
        ProjectInstruction.content,
        ProjectInstruction.updated_at,
    ]
    column_sortable_list = [ProjectInstruction.updated_at]
    can_create = True


class MeetingRoomAdmin(ModelView, model=MeetingRoom):
    name = "미팅룸"
    name_plural = "미팅룸"
    icon = "fa-solid fa-door-open"
    category = "게스트 입장"

    column_list = [
        MeetingRoom.room_code,
        MeetingRoom.title,
        MeetingRoom.host,
        MeetingRoom.project,
        MeetingRoom.status,
        MeetingRoom.max_participants,
        MeetingRoom.scheduled_at,
        MeetingRoom.ended_at,
        MeetingRoom.created_at,
    ]
    # 운영 케이스 2: 미팅 상세에서 진행상황(상태/일정)·참가 인원·셋팅(프로젝트/자료/언어/정원)을
    # 한 화면에서 확인. 평문 비밀번호는 여기서도 제외.
    column_details_list = [
        MeetingRoom.id,
        MeetingRoom.room_code,
        MeetingRoom.title,
        MeetingRoom.host,
        MeetingRoom.status,
        MeetingRoom.primary_language,
        MeetingRoom.max_participants,
        MeetingRoom.project,
        MeetingRoom.document,
        MeetingRoom.participants,
        MeetingRoom.scheduled_at,
        MeetingRoom.started_at,
        MeetingRoom.ended_at,
        MeetingRoom.expires_at,
        MeetingRoom.created_at,
        MeetingRoom.deleted_at,
    ]
    column_searchable_list = [MeetingRoom.room_code, MeetingRoom.title]
    column_sortable_list = [MeetingRoom.created_at, MeetingRoom.status]
    column_default_sort = [(MeetingRoom.created_at, True)]
    column_filters = [MeetingRoom.status, MeetingRoom.primary_language]
    # 평문 비밀번호는 운영자에게도 노출하지 않음 (column_details_list에도 포함 안 시킴)
    column_list_exclude_list = [MeetingRoom.password]
    form_excluded_columns = [MeetingRoom.password]
    can_create = True


class MeetingParticipantAdmin(ModelView, model=MeetingParticipant):
    name = "참가자"
    name_plural = "미팅 참가자"
    icon = "fa-solid fa-users"
    category = "게스트 입장"

    column_list = [
        MeetingParticipant.display_name,
        MeetingParticipant.room,
        MeetingParticipant.role,
        MeetingParticipant.language,
        MeetingParticipant.audio_enabled,
        MeetingParticipant.joined_at,
        MeetingParticipant.left_at,
        MeetingParticipant.is_kicked,
    ]
    column_sortable_list = [MeetingParticipant.joined_at]
    column_filters = [MeetingParticipant.role, MeetingParticipant.is_kicked]
    can_create = True


class GuestSessionAdmin(ModelView, model=GuestSession):
    name = "게스트 세션"
    name_plural = "게스트 세션"
    icon = "fa-solid fa-user-secret"
    category = "게스트 입장"

    # 운영 케이스 1: 임시 게스트(룸/이메일/언어/접속 정보/요약 발송 여부) 관리.
    column_list = [
        GuestSession.display_name,
        GuestSession.room,
        GuestSession.email,
        GuestSession.language,
        GuestSession.audio_enabled,
        GuestSession.ip_address,
        GuestSession.joined_at,
        GuestSession.expires_at,
        GuestSession.summary_sent,
    ]
    column_sortable_list = [GuestSession.joined_at, GuestSession.expires_at]
    column_filters = [GuestSession.language, GuestSession.summary_sent]
    column_searchable_list = [GuestSession.display_name, GuestSession.email]
    # JWT 토큰 값은 탈취 위험으로 노출/입력 모두 막음 (생성 시 모델에서 자동 발급).
    column_details_exclude_list = [GuestSession.session_token]
    column_list_exclude_list = [GuestSession.session_token]
    form_excluded_columns = [GuestSession.session_token]
    can_create = True
    can_edit = True


class MeetingSummaryAdmin(ModelView, model=MeetingSummary):
    name = "미팅 요약"
    name_plural = "미팅 요약"
    icon = "fa-solid fa-file-lines"
    category = "게스트 입장"

    column_list = [
        MeetingSummary.room,
        MeetingSummary.status,
        MeetingSummary.ai_model,
        MeetingSummary.processing_sec,
        MeetingSummary.created_at,
        MeetingSummary.completed_at,
    ]
    column_sortable_list = [MeetingSummary.created_at]
    column_filters = [MeetingSummary.status]
    can_create = True


class ReportAdmin(ModelView, model=Report):
    name = "신고"
    name_plural = "앱 문제 신고"
    icon = "fa-solid fa-triangle-exclamation"
    category = "운영"

    column_list = [
        Report.user,
        Report.category,
        Report.body,
        Report.app_version,
        Report.created_at,
    ]
    column_sortable_list = [Report.created_at, Report.category]
    column_default_sort = [(Report.created_at, True)]
    # 운영 케이스 3: 카테고리로 필터링 + 내용(본문) 검색.
    column_filters = [Report.category]
    column_searchable_list = [Report.body]
    can_create = True
    can_edit = True
