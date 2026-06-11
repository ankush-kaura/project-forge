import { cn } from "@/lib/utils"

interface ScoreBadgeProps {
  score: number
  className?: string
}

export function ScoreBadge({ score, className }: ScoreBadgeProps) {
  const color =
    score > 70
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : score >= 40
        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
        : "bg-red-500/20 text-red-400 border-red-500/30"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-bold",
        color,
        className
      )}
    >
      {score}
    </span>
  )
}
