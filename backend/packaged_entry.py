import os
import sys

# The PyInstaller bundle has no system CA store, so urllib/httpx/ssl can't
# verify TLS certs (model downloads + license server fail with
# CERTIFICATE_VERIFY_FAILED). Point the default SSL context at the CA bundle
# shipped alongside this executable (certifi/cacert.pem via the spec).
try:
    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

# Packaged (windowed) apps have no console, so sys.stdout/stderr are None and
# uvicorn's default logging formatter crashes calling .isatty() on them
# (AttributeError: 'NoneType' object has no attribute 'isatty'). Point them at
# devnull so logging config succeeds; app logs still go to woxus.log via the
# file handler in main.py's lifespan.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import uvicorn
from backend.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8457")),
        log_level="info",
    )
