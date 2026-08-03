import { Minus, Square, X } from 'lucide-react';

// Custom traffic-light window controls. The main window is frameless, so this
// bar provides the OS title-bar controls: macOS traffic lights on the left,
// Windows min/max/close on the right. The rest of the bar is a drag region.
export default function TitleBar() {
  const api = (window as any).electronAPI;
  const isMac = api?.platform === 'darwin';

  const minimize = () => api?.minimizeWindow?.();
  const toggleMax = () => api?.toggleMaximizeWindow?.();
  const close = () => api?.closeWindow?.();

  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;

  return (
    <div
      className="fixed top-0 inset-x-0 h-8 z-[100] flex items-center bg-[#0a0a0c]/85 backdrop-blur border-b border-border/40 select-none"
      style={drag}
    >
      {isMac ? (
        <div className="flex items-center gap-2 px-3 shrink-0" style={noDrag}>
          <button
            onClick={close}
            aria-label="Close"
            className="group w-3 h-3 rounded-full bg-[#ff5f57] flex items-center justify-center hover:brightness-110"
          >
            <X className="w-1.5 h-1.5 text-black opacity-0 group-hover:opacity-70" strokeWidth={3} />
          </button>
          <button
            onClick={minimize}
            aria-label="Minimize"
            className="group w-3 h-3 rounded-full bg-[#febc2e] flex items-center justify-center hover:brightness-110"
          >
            <Minus className="w-1.5 h-1.5 text-black opacity-0 group-hover:opacity-70" strokeWidth={3} />
          </button>
          <button
            onClick={toggleMax}
            aria-label="Maximize"
            className="group w-3 h-3 rounded-full bg-[#28c840] flex items-center justify-center hover:brightness-110"
          >
            <Square className="w-1.5 h-1.5 text-black opacity-0 group-hover:opacity-70" strokeWidth={3} />
          </button>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex-1 text-center text-[11px] text-muted-foreground/50 font-medium truncate">
        Woxus
      </div>

      {!isMac && (
        <div className="flex items-center h-full shrink-0" style={noDrag}>
          <button
            onClick={minimize}
            aria-label="Minimize"
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:bg-accent/60"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleMax}
            aria-label="Maximize"
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:bg-accent/60"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
