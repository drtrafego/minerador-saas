import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Badge de estado com cor semântica suave (fundo translúcido + texto da cor).
 * Padroniza os estados exibidos em inbox, leads e pipeline.
 */
export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-2 text-[11px] font-medium leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Mapeia um status de thread/lead para o tom semântico. */
export function toneForStatus(status: string): StatusTone {
  switch (status) {
    case "qualified":
    case "replied":
    case "booked":
    case "respondeu":
      return "success";
    case "needs_review":
    case "awaiting_reply":
    case "aguardando":
      return "warning";
    case "disqualified":
    case "failed":
    case "dead":
      return "danger";
    case "queued":
    case "active":
      return "info";
    default:
      return "neutral";
  }
}
