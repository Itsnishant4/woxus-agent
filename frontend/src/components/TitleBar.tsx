import { Minus, Square, X } from 'lucide-react';

// Custom window title bar (the main window is frameless). Controls keep a
// custom theme-styled look (no native buttons) but follow each platform's
// convention: macOS puts close/min/max on the left; Windows puts
// min/max/close on the right.
export default function TitleBar() {
  const api = (window as any).electronAPI;
  const isMac = api?.platform === 'darwin';
  const minimize = () => api?.minimizeWindow?.();
  const toggleMax = () => api?.toggleMaximizeWindow?.();
  const close = () => api?.closeWindow?.();

  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;

  const controlBtn =
    'w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground/70 hover:text-foreground hover:bg-accent/70 transition-colors';
  const controlBtnClose =
    'w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground/70 hover:text-white hover:bg-red-500/80 transition-colors';

  const min = (
    <button key="min" onClick={minimize} aria-label="Minimize" className={controlBtn}>
      <Minus className="h-3.5 w-3.5" />
    </button>
  );
  const max = (
    <button key="max" onClick={toggleMax} aria-label="Maximize" className={controlBtn}>
      <Square className="h-3 w-3" />
    </button>
  );
  const cls = (
    <button key="close" onClick={close} aria-label="Close" className={controlBtnClose}>
      <X className="h-3.5 w-3.5" />
    </button>
  );

  // macOS: close, minimize, maximize. Windows: minimize, maximize, close.
  const macOrder = [cls, min, max];
  const winOrder = [min, max, cls];

  const Controls = (order: typeof macOrder) => (
    <div className="flex items-center gap-1 px-2 h-full shrink-0" style={noDrag}>
      {order}
    </div>
  );

  const Brand = (
    <div className="flex items-center gap-2 px-3 shrink-0">
      <span className="w-2 h-2 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600" />
      <span className="text-[11px] font-medium tracking-tight text-muted-foreground/80">Woxus</span>
    </div>
  );

  return (
    <div
      className="relative h-12 shrink-0 flex items-center bg-background/85 backdrop-blur-sm border-b border-border/60 select-none"
      style={drag}
    >
      {isMac ? (
        <>
          {Controls(macOrder)}
          {Brand}
          <div className="flex-1" />
        </>
      ) : (
        <>
          {Brand}
          <div className="flex-1" />
          {Controls(winOrder)}
        </>
      )}
    </div>
  );
}