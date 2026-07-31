import os

import uvicorn
from backend.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        log_level="info",
    )
