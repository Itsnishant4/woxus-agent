import asyncio
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DANGEROUS_KEYWORDS = ["rm -rf", "format", "dd ", "mkfs", "> /dev/sda"]


def _is_dangerous(command: str) -> bool:
    lower = command.lower()
    for kw in DANGEROUS_KEYWORDS:
        if kw in lower:
            return True
    return False


async def execute_command(
    command: str,
    timeout: int = 30,
    max_retries: int = 3,
    workdir: str | None = None,
) -> dict:
    if _is_dangerous(command):
        return {
            "stdout": "",
            "stderr": "Command blocked: potentially destructive",
            "exit_code": -1,
        }

    cwd = workdir or str(Path.home())

    for attempt in range(1, max_retries + 1):
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
            out = stdout.decode("utf-8", errors="replace").strip()
            err = stderr.decode("utf-8", errors="replace").strip()
            exit_code = proc.returncode or 0

            if exit_code == 0:
                return {"stdout": out, "stderr": err, "exit_code": exit_code}

            logger.warning(
                "Attempt %d/%d failed (exit=%d): %s",
                attempt, max_retries, exit_code, command[:80],
            )
            if attempt < max_retries:
                await asyncio.sleep(2 ** attempt)

        except TimeoutError:
            logger.warning("Attempt %d/%d timed out: %s", attempt, max_retries, command[:80])
            if attempt < max_retries:
                await asyncio.sleep(2 ** attempt)

    return {
        "stdout": "",
        "stderr": f"Command failed after {max_retries} retries",
        "exit_code": -1,
    }
