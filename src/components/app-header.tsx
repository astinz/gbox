import { LayoutDashboardIcon, Settings2Icon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SystemStatus } from "@/types/gbox";

export type AppScreen = "dashboard" | "settings";

type Props = {
  screen: AppScreen;
  status: SystemStatus;
  onNavigate: (screen: AppScreen) => void;
};

export function AppHeader({ screen, status, onNavigate }: Props) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark"><ShieldCheckIcon /></span>
        <div>
          <span className="brand-name">gBox</span>
          <span className="brand-subtitle">evidence & control layer</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 lg:flex">
          <Badge variant={status.receiptChainValid ? "outline" : "destructive"}>
            Chain {status.receiptChainValid ? "verified" : "broken"}
          </Badge>
          <Badge variant="secondary">{status.replayMode ? "Replay" : "Live"}</Badge>
        </div>
        <nav className="flex items-center gap-1" aria-label="Primary">
          <Button
            variant={screen === "dashboard" ? "secondary" : "ghost"}
            aria-current={screen === "dashboard" ? "page" : undefined}
            onClick={() => onNavigate("dashboard")}
          >
            <LayoutDashboardIcon data-icon="inline-start" /> Dashboard
          </Button>
          <Button
            variant={screen === "settings" ? "secondary" : "ghost"}
            aria-current={screen === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            <Settings2Icon data-icon="inline-start" /> Settings
          </Button>
        </nav>
      </div>
    </header>
  );
}
