"""Woxus — Mini-agent task registry for parallel + barge-in work.

Each delegation from the main agent becomes a tracked MiniTask with an ID:
- voice keeps listening while tasks run (barge-in: task B starts mid task A)
- one utterance can fan out to many tasks at once (parallel)
- completions are announced back into the voice session by ID

Concurrency is bounded by a semaphore (default 10, raisable via
MAX_PARALLEL_MINI_TASKS env or settings.json `max_parallel_mini_tasks`,
clamped 1..100). Overflow tasks wait in `queued` state — they never fail.
"""

import asyncio
import logging
import os
import time
import uuid

logger = logging.getLogger(__name__)

DEFAULT_CAP = 10
MAX_CAP = 100


def max_parallel() -> int:
    """Parallel mini-task cap: env → settings.json → default 10."""
    raw = (os.getenv("MAX_PARALLEL_MINI_TASKS", "") or "").strip()
    if not raw:
        try:
            from ..paths import woxus_data_dir
            import json

            settings_file = woxus_data_dir() / "settings.json"
            if settings_file.exists():
                raw = str(json.loads(settings_file.read_text()).get("max_parallel_mini_tasks", "") or "").strip()
        except Exception:
            pass
    try:
        cap = int(raw or DEFAULT_CAP)
    except ValueError:
        cap = DEFAULT_CAP
    return max(1, min(cap, MAX_CAP))


class MiniTask:
    def __init__(self, label: str, prompt: str):
        self.task_id = uuid.uuid4().hex[:12]
        self.label = (label or prompt[:60] or "task").strip()[:120]
        self.prompt = prompt
        self.state = "queued"  # queued | running | done | failed | timeout
        self.result: dict = {}
        self.error = ""
        self.start_time = time.time()
        self.end_time: float | None = None
        self.announced = False
        self._done = asyncio.Event()

    @property
    def elapsed(self) -> float:
        end = self.end_time or time.time()
        return end - self.start_time

    def complete(self, result: dict):
        self.result = result or {}
        self.state = "failed" if result.get("error") or result.get("status") == "failed" else "done"
        if result.get("status") == "timeout":
            self.state = "timeout"
        self.end_time = time.time()
        self._done.set()

    def fail(self, error: str):
        self.error = error
        self.state = "failed"
        self.end_time = time.time()
        self._done.set()

    async def wait(self, timeout: float | None = None) -> dict:
        try:
            await asyncio.wait_for(self._done.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return {"status": "timeout", "task_id": self.task_id, "label": self.label}
        return {"task_id": self.task_id, "label": self.label, "state": self.state, **self.result}

    def summary(self) -> str:
        """One-line result for voice announcements."""
        r = self.result or {}
        text = r.get("message") or r.get("mini_agent_output") or r.get("error") or r.get("status") or "done"
        return str(text)[:300]

    def to_dict(self) -> dict:
        """Mirror BackgroundTask fields so the existing Tasks UI lists these
        with zero frontend changes (command = label, stdout = result)."""
        return {
            "task_id": self.task_id,
            "label": self.label,
            "command": f"🤖 {self.label}",
            "state": self.state,
            "exit_code": 0 if self.state == "done" else (1 if self.state == "failed" else None),
            "stdout": self.summary(),
            "stderr": self.error,
            "elapsed_seconds": round(self.elapsed, 1),
            "start_time": self.start_time,
            "end_time": self.end_time,
        }


class MiniTaskManager:
    def __init__(self):
        self._tasks: dict[str, MiniTask] = {}
        self._sem: asyncio.Semaphore | None = None
        self._sem_size = 0

    def _get_sem(self) -> asyncio.Semaphore:
        cap = max_parallel()
        # Rebuild only when idle so a live semaphore is never swapped mid-run.
        running = sum(1 for t in self._tasks.values() if t.state in ("queued", "running"))
        if self._sem is None or (cap != self._sem_size and running == 0):
            self._sem = asyncio.Semaphore(cap)
            self._sem_size = cap
        return self._sem

    def submit(self, label: str, prompt: str, runner) -> MiniTask:
        """Register a task and schedule it. `runner` is an async callable
        taking the MiniTask and returning a result dict."""
        task = MiniTask(label, prompt)
        # Evict oldest finished beyond 100 kept.
        finished = [t for t in self._tasks.values() if t.state not in ("queued", "running")]
        if len(self._tasks) >= 100 and finished:
            oldest = min(finished, key=lambda t: t.start_time)
            del self._tasks[oldest.task_id]
        self._tasks[task.task_id] = task
        asyncio.create_task(self._run(task, runner))
        logger.info("Mini task %s queued: %s", task.task_id, task.label[:80])
        return task

    async def _run(self, task: MiniTask, runner):
        sem = self._get_sem()
        async with sem:
            if task.state == "queued":
                task.state = "running"
            try:
                result = await runner(task)
                task.complete(result if isinstance(result, dict) else {"message": str(result)})
            except asyncio.CancelledError:
                task.fail("cancelled")
                raise
            except Exception as e:
                logger.exception("Mini task %s failed", task.task_id)
                task.fail(str(e))

    def get(self, task_id: str) -> MiniTask | None:
        return self._tasks.get(task_id)

    def list(self) -> "list[MiniTask]":
        return sorted(self._tasks.values(), key=lambda t: t.start_time, reverse=True)

    def pending(self) -> "list[MiniTask]":
        return [t for t in self._tasks.values() if t.state in ("queued", "running") and not t.announced]


_manager = MiniTaskManager()


def get_mini_task_manager() -> MiniTaskManager:
    return _manager


async def await_mini_task(task_id: str, timeout: float | None = 300) -> dict:
    task = _manager.get(task_id)
    if not task:
        return {"error": f"No mini task found: {task_id}"}
    return await task.wait(timeout=timeout)
