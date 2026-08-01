import { ShieldAlert, Settings2 } from 'lucide-react';
import { Button } from '@heroui/react';

export default function PermissionGatePage() {
  const handleOpenSettings = () => {
    // @ts-ignore
    window.electronAPI?.openPermissionSettings?.();
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-md px-6">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-lg space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <ShieldAlert className="h-7 w-7 text-amber-500" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-semibold tracking-tight">Automation Permission Required</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Woxus needs the <span className="text-foreground font-medium">Accessibility</span> permission
              to paste generated prompts into your apps (browsers, editors, terminals).
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Grant it in System Settings, then return here. Woxus stays locked until the permission is granted.
            </p>
          </div>

          <Button variant="primary" className="w-full" onPress={handleOpenSettings}>
            <Settings2 className="h-4 w-4" />
            Open System Settings
          </Button>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Waiting for permission — checking...
          </div>
        </div>
      </div>
    </div>
  );
}
