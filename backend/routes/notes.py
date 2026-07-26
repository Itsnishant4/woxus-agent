import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models.schemas import FileWriterRequest, FileWriterResponse
from ..services.file_writer import write_file

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/write")
async def write_note(req: FileWriterRequest):
    if not req.path or not req.path.strip():
        raise HTTPException(400, "File path is required")

    result = write_file(req.path.strip(), req.content)

    if "error" in result:
        raise HTTPException(400, result["error"])

    return FileWriterResponse(path=result["path"], size=result["size"])


@router.get("/list")
async def list_notes(directory: str = ""):
    base = Path(directory).resolve() if directory else Path.home()
    if not base.exists() or not base.is_dir():
        raise HTTPException(404, "Directory not found")

    files = []
    for f in sorted(base.iterdir()):
        if f.is_file() and f.suffix in {
            ".md", ".txt", ".json", ".js", ".ts", ".py",
            ".html", ".css", ".jsx", ".tsx", ".yaml", ".yml",
        }:
            files.append({
                "name": f.name,
                "path": str(f),
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return {"directory": str(base), "files": files}
