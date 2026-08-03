import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import load_config
from .middleware import license_check_middleware, trial_limiter_middleware
from .routes import bugs, chat, feedback, license, memory, model, notes, overlay, settings, system, tasks, terminal, trial, voice


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    app.state.config = config
    log_file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "woxus.log"))
    file_handler = logging.FileHandler(log_file_path, mode="a", encoding="utf-8")
    stream_handler = logging.StreamHandler()
    logging.basicConfig(
        level=getattr(logging, config.get("LOG_LEVEL", "INFO")),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[file_handler, stream_handler],
        force=True,
    )
    logging.info("Woxus backend starting…")
    # Pre-load the local mini-agent model in the background so the first
    # delegated task doesn't pay the ~3s model load. Polls until the model
    # file is downloaded (the frontend's model gate), then loads it once into
    # memory where it stays resident (nano_inference caches it as a singleton).
    asyncio.create_task(_preload_mini_agent_model())
    yield
    logging.info("Woxus backend shutting down.")


async def _preload_mini_agent_model():
    """Load the SmolLM3 mini-agent model at startup and keep it resident."""
    from .services.nano_inference import warm_up

    for _ in range(60):  # up to ~5 minutes for the model download to finish
        try:
            ok = await asyncio.to_thread(warm_up)
            if ok:
                logging.getLogger("backend.services.nano_inference").info(
                    "🤖 [NANOAGENT] Mini-agent model pre-loaded and resident"
                )
                return
        except Exception as e:
            logging.getLogger("backend").warning("🤖 [NANOAGENT] Warm-up error: %s", e)
        await asyncio.sleep(5)
    logging.getLogger("backend").warning(
        "🤖 [NANOAGENT] Mini-agent model not ready after startup wait"
    )


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

app.include_router(bugs.router, prefix="/api/bugs", tags=["bugs"])
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
app.include_router(model.router, prefix="/api/model", tags=["model"])
app.include_router(overlay.router, prefix="/api/overlay", tags=["overlay"])


if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8457")),
        reload=True,
        log_level="info",
    )
