from pydantic import BaseModel
from typing import Optional


class SendMessageRequest(BaseModel):
    conversation_id: Optional[str] = None
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
    content: Optional[str] = None
    importance: Optional[float] = None
    active: Optional[bool] = None


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
    expiry: Optional[str] = None
    features: list[str] = []
    reason: Optional[str] = None


class TrialStartRequest(BaseModel):
    hardware_id: str
    device_info: Optional[str] = None


class TrialStatusResponse(BaseModel):
    active: bool
    remaining_seconds: int
    total_seconds: int


class FeedbackSubmit(BaseModel):
    rating: int
    text: Optional[str] = None
    hardware_id: Optional[str] = None
