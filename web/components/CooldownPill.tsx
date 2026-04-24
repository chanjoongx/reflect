import { Timer, Zap } from "lucide-react";
import { Pill } from "@/components/ui/Pill";

interface CooldownPillProps {
  remaining: number;
}

export function CooldownPill({ remaining }: CooldownPillProps) {
  if (remaining <= 0) {
    return (
      <Pill
        tone="teal"
        size="md"
        icon={<Zap className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
        value="armed"
        label="cooldown"
      />
    );
  }
  return (
    <Pill
      tone="orange"
      size="md"
      icon={<Timer className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
      value={`${remaining}`}
      label={`turn${remaining === 1 ? "" : "s"} cooldown`}
    />
  );
}
