"""sqladmin이 들여다볼 SQLAlchemy 모델.

supabase/migrations/*.sql에 정의된 테이블을 그대로 매핑한다. 마이그레이션으로
컬럼을 추가/변경하면 여기도 같이 갱신해야 한다 (자동 동기화 아님 — Django의
makemigrations처럼 모델이 먼저가 아니라, SQL 마이그레이션이 먼저고 모델이 뒤따라간다).

auth.users(Supabase Auth 내부 테이블)는 GoTrue가 전적으로 관리하므로 여기서
매핑하지 않는다. 운영자가 유저를 봐야 할 땐 public.users를 사용한다.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str]
    name: Mapped[str]
    phone: Mapped[str | None]
    country_code: Mapped[str]
    company_email: Mapped[str | None]
    position: Mapped[str | None]
    company_name: Mapped[str | None]
    primary_language: Mapped[str]
    avatar_url: Mapped[str | None]
    signup_method: Mapped[str]
    is_onboarded: Mapped[bool]
    is_admin: Mapped[bool]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    plan: Mapped["UserPlan"] = relationship(back_populates="user", uselist=False)
    oauth_providers: Mapped[list["OAuthProvider"]] = relationship(back_populates="user")

    def __str__(self) -> str:
        return f"{self.name} <{self.email}>"


class UserPlan(Base):
    __tablename__ = "user_plans"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.users.id")
    )
    plan: Mapped[str]
    status: Mapped[str]
    minutes_total: Mapped[int]
    minutes_used: Mapped[int]
    overage_rate: Mapped[float] = mapped_column(Numeric(5, 2))
    period_start: Mapped[date]
    period_end: Mapped[date]
    stripe_sub_id: Mapped[str | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    user: Mapped["User"] = relationship(back_populates="plan")

    def __str__(self) -> str:
        return f"{self.plan} ({self.status})"


class BusinessCard(Base):
    __tablename__ = "business_cards"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_token: Mapped[str]
    raw_text: Mapped[str | None]
    name: Mapped[str | None]
    company_email: Mapped[str | None]
    phone: Mapped[str | None]
    company_name: Mapped[str | None]
    position: Mapped[str | None]
    image_url: Mapped[str | None]
    ocr_provider: Mapped[str]
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime]

    def __str__(self) -> str:
        return self.name or self.session_token


class OAuthProvider(Base):
    __tablename__ = "oauth_providers"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.users.id")
    )
    provider: Mapped[str]
    provider_uid: Mapped[str]
    email: Mapped[str | None]
    access_token: Mapped[str | None]
    refresh_token: Mapped[str | None]
    token_expires: Mapped[datetime | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    user: Mapped["User"] = relationship(back_populates="oauth_providers")

    def __str__(self) -> str:
        return f"{self.provider}:{self.provider_uid}"


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.users.id"))
    name: Mapped[str]
    description: Mapped[str | None]
    created_at: Mapped[datetime]
    deleted_at: Mapped[datetime | None]

    user: Mapped["User"] = relationship()

    def __str__(self) -> str:
        return self.name


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.users.id"))
    title: Mapped[str]
    file_url: Mapped[str | None]
    created_at: Mapped[datetime]
    deleted_at: Mapped[datetime | None]

    user: Mapped["User"] = relationship()

    def __str__(self) -> str:
        return self.title


class DocumentMessage(Base):
    __tablename__ = "document_messages"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.documents.id"))
    type: Mapped[str]
    content: Mapped[str | None]
    file_url: Mapped[str | None]
    file_name: Mapped[str | None]
    status: Mapped[str]
    analysis_result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime]

    document: Mapped["Document"] = relationship()

    def __str__(self) -> str:
        return f"{self.type}:{self.document_id} ({self.status})"


class DocumentContext(Base):
    __tablename__ = "document_contexts"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.documents.id"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.document_messages.id")
    )
    analysis_points: Mapped[dict] = mapped_column(JSONB)
    technical_terms: Mapped[dict | None] = mapped_column(JSONB)
    language_hint: Mapped[str | None]
    priority: Mapped[str | None]
    created_at: Mapped[datetime]

    document: Mapped["Document"] = relationship()

    def __str__(self) -> str:
        return f"context:{self.document_id}"


class ProjectDocument(Base):
    __tablename__ = "project_documents"
    __table_args__ = {"schema": "public"}

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.projects.id"), primary_key=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.documents.id"))
    applied_at: Mapped[datetime]

    project: Mapped["Project"] = relationship()
    document: Mapped["Document"] = relationship()

    def __str__(self) -> str:
        return f"{self.project_id} → {self.document_id}"


class ProjectInstruction(Base):
    __tablename__ = "project_instructions"
    __table_args__ = {"schema": "public"}

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.projects.id"), primary_key=True
    )
    content: Mapped[str]
    updated_at: Mapped[datetime]

    project: Mapped["Project"] = relationship()

    def __str__(self) -> str:
        return f"지시사항:{self.project_id}"


class MeetingRoom(Base):
    __tablename__ = "meeting_rooms"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    host_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.users.id"))
    room_code: Mapped[str]
    title: Mapped[str | None]
    password_hash: Mapped[str | None]
    max_participants: Mapped[int]
    primary_language: Mapped[str]
    status: Mapped[str]
    scheduled_at: Mapped[datetime | None]
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    expires_at: Mapped[datetime]
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.projects.id")
    )
    created_at: Mapped[datetime]
    deleted_at: Mapped[datetime | None]

    host: Mapped["User"] = relationship()
    participants: Mapped[list["MeetingParticipant"]] = relationship(back_populates="room")
    project: Mapped["Project | None"] = relationship()

    def __str__(self) -> str:
        return f"{self.room_code} ({self.status})"


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.meeting_rooms.id")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("public.users.id"))
    guest_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.guest_sessions.id")
    )
    display_name: Mapped[str]
    role: Mapped[str]
    language: Mapped[str]
    audio_enabled: Mapped[bool]
    joined_at: Mapped[datetime]
    left_at: Mapped[datetime | None]
    is_kicked: Mapped[bool]

    room: Mapped["MeetingRoom"] = relationship(back_populates="participants")

    def __str__(self) -> str:
        return f"{self.display_name} ({self.role})"


class GuestSession(Base):
    __tablename__ = "guest_sessions"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_token: Mapped[str]
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.meeting_rooms.id")
    )
    display_name: Mapped[str]
    email: Mapped[str | None]
    language: Mapped[str]
    audio_enabled: Mapped[bool]
    device_info: Mapped[dict | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None]
    summary_sent: Mapped[bool]
    joined_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime]

    def __str__(self) -> str:
        return self.display_name


class MeetingSummary(Base):
    __tablename__ = "meeting_summaries"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.meeting_rooms.id")
    )
    summary_text: Mapped[str | None]
    action_items: Mapped[list] = mapped_column(JSONB)
    script_url: Mapped[str | None]
    status: Mapped[str]
    ai_model: Mapped[str | None]
    processing_sec: Mapped[int | None]
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
    deleted_at: Mapped[datetime | None]

    def __str__(self) -> str:
        return f"summary:{self.room_id} ({self.status})"


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.users.id"))
    category: Mapped[str]
    body: Mapped[str]
    device_info: Mapped[dict | None] = mapped_column(JSONB)
    app_version: Mapped[str | None]
    created_at: Mapped[datetime]

    user: Mapped["User"] = relationship()

    def __str__(self) -> str:
        return f"{self.category}: {self.body[:30]}"
