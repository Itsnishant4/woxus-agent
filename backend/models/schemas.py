"""Pydantic request/response models for all endpoints."""

from pydantic import BaseModel
from typing import Optional


# --- Chat ---
class SendMessageRequest(BaseModel):
    conversation_id: Optional[str] = None
    content: str


class SendMessageResponse(BaseModel):
    conversation_id: str
    message_id: str
    content: str


# --- Memory ---
class Memory(BaseModel):
    id: str
    category: str
    content: str
    importance: float
    active: bool


# --- Settings ---
class ApiKeyUpdate(BaseModel):
    provider: str
    key: str


# --- System ---
class HealthResponse(BaseModel):
    status: str
    version: str
    name: str


class StatusResponse(BaseModel):
    backend: str
    agent: str
    memory: str
    voice: str
