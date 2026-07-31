import { useState, useEffect, useCallback } from 'react';
import { Terminal, FileText, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { API_BASE } from '@/services/api';

interface Task {
  task_id: string;
  command: string;
  state: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  elapsed_seconds: number;
}

function taskIcon(command: string) {
  if (command.includes('create') || command.includes('npm') || command.includes('npx')) return Terminal;
  if (command.includes('write') || command.includes('echo')) return FileText;
  return Terminal;
}

function stateIcon(state: string) {
  switch (state) {
    case 'running': return Loader2;
    case 'done': return CheckCircle;
    case 'failed': return XCircle;
    default: return Clock;
  }
}

function stateColor(state: string) {
  switch (state) {
    case 'running': return 'text-blue-500';
    case 'done': return 'text-green-500';
    case 'failed': return 'text-red-500';
    default: return 'text-muted-foreground';
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const running = tasks.filter(t => t.state === 'running');
  const done = tasks.filter(t => t.state !== 'running');

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {running.length > 0
            ? `${running.length} task${running.length > 1 ? 's' : ''} running`
            : 'No active tasks'}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading...</p>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Terminal className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No tasks yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Tasks appear here when Woxus runs commands
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {running.map(t => <TaskCard key={t.task_id} task={t} />)}
          {done.map(t => <TaskCard key={t.task_id} task={t} />)}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = taskIcon(task.command);
  const SIcon = stateIcon(task.state);
  const color = stateColor(task.state);
  const spinning = task.state === 'running';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{task.command}</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            {task.elapsed_seconds.toFixed(0)}s · {task.state}
          </p>
        </div>
        <SIcon className={`h-4 w-4 shrink-0 ${color} ${spinning ? 'animate-spin' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
          {task.stdout && (
            <div>
              <p className="text-[11px] text-muted-foreground/60 font-medium mb-1">stdout</p>
              <pre className="text-xs text-foreground bg-muted rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {task.stdout}
              </pre>
            </div>
          )}
          {task.stderr && (
            <div>
              <p className="text-[11px] text-muted-foreground/60 font-medium mb-1">stderr</p>
              <pre className="text-xs text-red-500 bg-muted rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {task.stderr}
              </pre>
            </div>
          )}
          {task.exit_code !== null && (
            <p className="text-[11px] text-muted-foreground/60">
              Exit code: {task.exit_code}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
