from typing import Optional

from pydantic import BaseModel


class SendMessageRequest(BaseModel):
    conversation_id: str | None = None
    content: str


class SendMessageResponse(BaseModel):
    conversation_id: str
    message_id: str
    content: str


class ConversationListItem(BaseModel):
    id: str
    title: str
    updated_at: str
    pinned: bool


class MemoryOut(BaseModel):
    id: str
    category: str
    content: str
    importance: float
    active: bool
    created_at: str
    updated_at: str


class MemoryCreate(BaseModel):
    category: str
    content: str
    importance: float = 0.5


class MemoryUpdate(BaseModel):
    content: str | None = None
    importance: float | None = None
    active: bool | None = None


class MemorySearchResult(BaseModel):
    id: str
    category: str
    content: str
    importance: float
    score: float


class ApiKeyUpdate(BaseModel):
    provider: str
    key: str


class ApiKeyStatus(BaseModel):
    provider: str
    configured: bool
    masked_key: str


class SettingsOut(BaseModel):
    keys: list[ApiKeyStatus]
    gemini_model: str


class HealthResponse(BaseModel):
    status: str
    version: str
    name: str


class StatusResponse(BaseModel):
    backend: str
    agent: str
    memory: str
    voice: str


class TerminalCommandRequest(BaseModel):
    command: str


class TerminalCommandResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class FileWriterRequest(BaseModel):
    path: str
    content: str


class FileWriterResponse(BaseModel):
    path: str
    size: int


class LicenseVerifyRequest(BaseModel):
    license_key: str
    hardware_id: str


class LicenseVerifyResponse(BaseModel):
    valid: bool
    expiry: str | None = None
    features: list[str] = []
    reason: str | None = None
    offline: bool | None = None


class TrialStartRequest(BaseModel):
    hardware_id: str
    device_info: str | None = None
    email: str | None = None


class TrialStatusResponse(BaseModel):
    active: bool
    remaining_seconds: int
    total_seconds: int
    email: str | None = None


class FeedbackSubmit(BaseModel):
    rating: int
    text: str | None = None
    hardware_id: str | None = None
