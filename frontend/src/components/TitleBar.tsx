import { Minus, Square, X } from 'lucide-react';

// Custom window title bar (the main window is frameless). One consistent,
// theme-matched design across platforms — a violet brand mark on the left and
// min/max/close controls on the right (no native macOS/Windows buttons).
export default function TitleBar() {
  const api = (window as any).electronAPI;
  const minimize = () => api?.minimizeWindow?.();
  const toggleMax = () => api?.toggleMaximizeWindow?.();
  const close = () => api?.closeWindow?.();

  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;
  const controlBtn =
    'w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-accent/70 transition-colors';

  return (
    <div
      className="relative h-8 shrink-0 flex items-center bg-background/85 backdrop-blur-sm border-b border-border/60 select-none"
      style={drag}
    >
      {/* Brand mark (left) */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <span className="w-2 h-2 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600" />
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground/80">
          Woxus
        </span>
      </div>

      {/* Drag region */}
      <div className="flex-1" />

      {/* Custom window controls (right) */}
      <div className="flex items-center gap-1 pr-2 h-full shrink-0" style={noDrag}>
        <button onClick={minimize} aria-label="Minimize" className={controlBtn}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button onClick={toggleMax} aria-label="Maximize" className={controlBtn}>
          <Square className="h-3 w-3" />
        </button>
        <button
          onClick={close}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-white hover:bg-red-500/80 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}