"""웹 어드민 마운트 지점.

app/main.py에서 setup_admin(app) 한 줄만 호출하면 /admin 경로에 전체 어드민이
붙는다. 새 모델 추가 시 views.py에 ModelView를 만들고 여기 add_view 목록에
한 줄 추가하면 끝.
"""

from fastapi import FastAPI
from sqladmin import Admin
from starlette.middleware.sessions import SessionMiddleware

from app.admin.auth import AdminAuth
from app.admin.db import get_admin_engine
from app.admin.views import (
    AiUsageDashboard,
    AiUsageLogAdmin,
    BusinessCardAdmin,
    DocumentAdmin,
    DocumentContextAdmin,
    DocumentMessageAdmin,
    GuestSessionAdmin,
    MeetingParticipantAdmin,
    MeetingRoomAdmin,
    MeetingSummaryAdmin,
    OAuthProviderAdmin,
    ProjectAdmin,
    ProjectDocumentAdmin,
    ProjectInstructionAdmin,
    ReportAdmin,
    UserAdmin,
    UserPlanAdmin,
)
from app.config import settings


def setup_admin(app: FastAPI) -> Admin:
    app.add_middleware(SessionMiddleware, secret_key=settings.admin_session_secret)

    admin = Admin(
        app,
        engine=get_admin_engine(),
        authentication_backend=AdminAuth(secret_key=settings.admin_session_secret),
        title="Preter Admin",
    )

    admin.add_view(UserAdmin)
    admin.add_view(UserPlanAdmin)
    admin.add_view(BusinessCardAdmin)
    admin.add_view(OAuthProviderAdmin)
    admin.add_view(ProjectAdmin)
    admin.add_view(DocumentAdmin)
    admin.add_view(DocumentMessageAdmin)
    admin.add_view(DocumentContextAdmin)
    admin.add_view(ProjectDocumentAdmin)
    admin.add_view(ProjectInstructionAdmin)
    admin.add_view(MeetingRoomAdmin)
    admin.add_view(MeetingParticipantAdmin)
    admin.add_view(GuestSessionAdmin)
    admin.add_view(MeetingSummaryAdmin)
    admin.add_view(ReportAdmin)
    admin.add_view(AiUsageLogAdmin)
    admin.add_base_view(AiUsageDashboard)

    return admin
