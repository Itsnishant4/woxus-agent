"""Woxus backend — FastAPI server entrypoint."""

import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import chat, memory, settings, system, voice
from config import load_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle handler."""
    config = load_config()
    app.state.config = config
    logging.basicConfig(
        level=getattr(logging, config.get("LOG_LEVEL", "INFO")),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logging.info("Woxus backend starting…")
    yield
    logging.info("Woxus backend shutting down.")


app = FastAPI(
    title="Woxus",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(voice.router, prefix="/api/voice", tags=["voice"])


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        reload=True,
        log_level="info",
    )
