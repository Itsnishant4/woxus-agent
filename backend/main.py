import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import chat, memory, settings, system, voice, terminal, notes, license, trial, feedback, tasks, overlay
from .config import load_config
from .middleware import license_check_middleware, trial_limiter_middleware


@asynccontextmanager
async def lifespan(app: FastAPI):
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

app.middleware("http")(license_check_middleware)
app.middleware("http")(trial_limiter_middleware)

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(voice.router, prefix="/api/voice", tags=["voice"])
app.include_router(terminal.router, prefix="/api/terminal", tags=["terminal"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(license.router, prefix="/api/license", tags=["license"])
app.include_router(trial.router, prefix="/api/trial", tags=["trial"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(overlay.router, prefix="/api/overlay", tags=["overlay"])


if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        reload=True,
        log_level="info",
    )
