"""Route initializers — each sub-module is populated during its phase."""

# Routes can either be modules or a package. This keeps the import clean.
from . import chat, memory, settings, system, voice
