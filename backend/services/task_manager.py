"""Woxus — Background task manager for long-running terminal commands.

AI agent starts command in background with `terminal_exec(background=true)`.
Agent polls status with `terminal_status(task_id=...)`.
"""

import asyncio
import logging
import os
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)


class BackgroundTask:
    state: str  # "running" | "done" | "failed"
    exit_code: int | None
    stdout: str
    stderr: str
    start_time: float
    end_time: float | None

    def __init__(self, command: str, cwd: str | None = None):
        self.task_id = uuid.uuid4().hex[:12]
        self.command = command
        self.cwd = cwd or os.getcwd()
        self.state = "running"
        self.exit_code = None
        self.stdout = ""
        self.stderr = ""
        self.start_time = time.time()
        self.end_time = None
        self._process = None

    @property
    def elapsed(self) -> float:
        return time.time() - self.start_time

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "command": self.command,
            "state": self.state,
            "exit_code": self.exit_code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "elapsed_seconds": round(self.elapsed, 1),
            "start_time": self.start_time,
            "end_time": self.end_time,
        }


class TaskManager:
    """Manages background shell tasks the AI agent spawns."""

    def __init__(self, max_tasks: int = 50):
        self._tasks: dict[str, BackgroundTask] = {}
        self._max_tasks = max_tasks

    async def start(self, command: str, cwd: str | None = None) -> BackgroundTask:
        """Start a command in the background."""
        if len(self._tasks) >= self._max_tasks:
            # Evict oldest completed task
            done = [t for t in self._tasks.values() if t.state != "running"]
            if done:
                oldest = min(done, key=lambda t: t.start_time)
                del self._tasks[oldest.task_id]

        task = BackgroundTask(command, cwd)
        self._tasks[task.task_id] = task

        async def _run():
            try:
                proc = await asyncio.create_subprocess_shell(
                    command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=task.cwd,
                )
                task._process = proc
                std_out, std_err = await asyncio.wait_for(
                    proc.communicate(input=b"y\n"), timeout=None
                )
                task.stdout = std_out.decode("utf-8", errors="replace")
                task.stderr = std_err.decode("utf-8", errors="replace")
                task.exit_code = proc.returncode

                if proc.returncode != 0:
                    logger.info("🤖 [MINI-AGENT] Task %s failed (exit %d). Invoking Mini Agent to auto-heal...", task.task_id, proc.returncode)
                    from .mini_agent import auto_heal_command
                    healed = await auto_heal_command(
                        original_command=command,
                        error_message=f"Process exited with code {proc.returncode}",
                        stdout=task.stdout,
                        stderr=task.stderr,
                        cwd=task.cwd,
                    )
                    if healed.get("healed"):
                        task.exit_code = 0
                        task.state = "done"
                        task.stdout += f"\n\n🤖 [Mini Agent Auto-Healed Successfully]\n{healed.get('stdout', '')}"
                    else:
                        task.state = "failed"
                else:
                    task.state = "done"
            except asyncio.CancelledError:
                task.state = "failed"
                task.stderr = "Task cancelled"
            except Exception as e:
                logger.info("🤖 [MINI-AGENT] Exception in task %s: %s. Invoking Mini Agent...", task.task_id, e)
                from .mini_agent import auto_heal_command
                healed = await auto_heal_command(
                    original_command=command,
                    error_message=str(e),
                    cwd=task.cwd,
                )
                if healed.get("healed"):
                    task.exit_code = 0
                    task.state = "done"
                    task.stdout = healed.get("stdout", "")
                else:
                    task.state = "failed"
                    task.stderr = str(e)
            finally:
                task.end_time = time.time()

        asyncio.create_task(_run())
        logger.info("Background task %s started: %s", task.task_id, command[:120])
        return task

    def get(self, task_id: str) -> BackgroundTask | None:
        return self._tasks.get(task_id)

    def list(self) -> list[BackgroundTask]:
        """Return all tasks sorted by start time descending."""
        return sorted(
            self._tasks.values(),
            key=lambda t: t.start_time,
            reverse=True,
        )

    def cancel(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task and task._process and task.state == "running":
            task._process.terminate()
            task.state = "failed"
            task.stderr = "Terminated by user"
            return True
        return False


_task_manager = TaskManager()


def get_task_manager() -> TaskManager:
    return _task_manager
