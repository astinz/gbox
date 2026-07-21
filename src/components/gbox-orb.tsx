import { ThinkingOrb, type OrbSize, type OrbState, type OrbTheme } from "thinking-orbs";

import { cn } from "@/lib/utils";

type Props = {
  state: OrbState;
  size?: OrbSize;
  paused?: boolean;
  theme?: OrbTheme;
  className?: string;
};

export function GboxOrb({
  state,
  size = 20,
  paused = false,
  theme = "auto",
  className,
}: Props) {
  return (
    <span
      className={cn("gbox-orb", size === 64 && "gbox-orb--large", className)}
      data-orb-state={state}
      data-paused={paused}
      aria-hidden="true"
    >
      <ThinkingOrb
        state={state}
        size={size}
        speed={0.85}
        paused={paused}
        theme={theme}
        aria-hidden="true"
      />
    </span>
  );
}
