"""테이블별 어드민 화면 정의.

새 테이블이 추가되면: app/admin/models.py에 모델 추가 → 여기에 ModelView 하나
추가 → app/admin/__init__.py의 setup_admin()에서 admin.add_view() 한 줄.
그게 끝이다. 디자인이나 프론트엔드 작업이 필요 없다.
"""

from sqladmin import ModelView

from app.admin.models import BusinessCard, OAuthProvider, User, UserPlan


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
