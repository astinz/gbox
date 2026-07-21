import { LayoutDashboardIcon, Settings2Icon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type AppScreen = "dashboard" | "settings";

type Props = {
  screen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
};

export function AppHeader({ screen, onNavigate }: Props) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark"><ShieldCheckIcon /></span>
        <div>
          <span className="brand-name">gBox</span>
          <span className="brand-subtitle">claim review & approvals</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
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
