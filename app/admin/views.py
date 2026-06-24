"""테이블별 어드민 화면 정의.

새 테이블이 추가되면: app/admin/models.py에 모델 추가 → 여기에 ModelView 하나
추가 → app/admin/__init__.py의 setup_admin()에서 admin.add_view() 한 줄.
그게 끝이다. 디자인이나 프론트엔드 작업이 필요 없다.
"""

from sqladmin import ModelView

from app.admin.models import (
    BusinessCard,
    GuestSession,
    MeetingParticipant,
    MeetingRoom,
    MeetingSummary,
    OAuthProvider,
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


class MeetingRoomAdmin(ModelView, model=MeetingRoom):
    name = "미팅룸"
    name_plural = "미팅룸"
    icon = "fa-solid fa-door-open"
    category = "게스트 입장"

    column_list = [
        MeetingRoom.room_code,
        MeetingRoom.title,
        MeetingRoom.host,
        MeetingRoom.status,
        MeetingRoom.max_participants,
        MeetingRoom.scheduled_at,
        MeetingRoom.ended_at,
        MeetingRoom.created_at,
    ]
    column_searchable_list = [MeetingRoom.room_code, MeetingRoom.title]
    column_sortable_list = [MeetingRoom.created_at, MeetingRoom.status]
    column_default_sort = [(MeetingRoom.created_at, True)]
    # 비밀번호 해시는 운영자도 노출하지 않음
    column_details_exclude_list = [MeetingRoom.password_hash]
    column_list_exclude_list = [MeetingRoom.password_hash]
    can_create = False


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
        MeetingParticipant.joined_at,
        MeetingParticipant.left_at,
        MeetingParticipant.is_kicked,
    ]
    column_sortable_list = [MeetingParticipant.joined_at]
    can_create = False


class GuestSessionAdmin(ModelView, model=GuestSession):
    name = "게스트 세션"
    name_plural = "게스트 세션"
    icon = "fa-solid fa-user-secret"
    category = "게스트 입장"

    column_list = [
        GuestSession.display_name,
        GuestSession.room_id,
        GuestSession.email,
        GuestSession.language,
        GuestSession.joined_at,
        GuestSession.expires_at,
        GuestSession.summary_sent,
    ]
    column_sortable_list = [GuestSession.joined_at, GuestSession.expires_at]
    # JWT 토큰 값은 탈취 위험으로 노출하지 않음
    column_details_exclude_list = [GuestSession.session_token]
    column_list_exclude_list = [GuestSession.session_token]
    can_create = False
    can_edit = False


class MeetingSummaryAdmin(ModelView, model=MeetingSummary):
    name = "미팅 요약"
    name_plural = "미팅 요약"
    icon = "fa-solid fa-file-lines"
    category = "게스트 입장"

    column_list = [
        MeetingSummary.room_id,
        MeetingSummary.status,
        MeetingSummary.ai_model,
        MeetingSummary.processing_sec,
        MeetingSummary.created_at,
        MeetingSummary.completed_at,
    ]
    column_sortable_list = [MeetingSummary.created_at]
    can_create = False


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
    can_create = False
    can_edit = False
