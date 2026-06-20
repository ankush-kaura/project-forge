import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CheckCircle2,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Star,
} from "lucide-react"
import type { ArchitectureOption } from "@/types"

interface ArchitectureCardProps {
  option: ArchitectureOption
  selected: boolean
  onSelect: (id: string) => void
  disabled?: boolean
}

export function ArchitectureCard({
  option,
  selected,
  onSelect,
  disabled,
}: ArchitectureCardProps) {
  return (
    <Card
      className={`relative transition-all ${
        selected
          ? "border-green-500/60 bg-green-500/5 shadow-lg shadow-green-500/10"
          : "hover:border-muted-foreground/30"
      }`}
    >
      {selected && (
        <div className="absolute -top-2 -right-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow">
            <CheckCircle2 className="h-3 w-3" />
            Selected
          </span>
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{option.name}</CardTitle>
          <Badge
            variant="secondary"
            className="flex items-center gap-1 shrink-0"
          >
            <Clock className="h-3 w-3" />
            {option.estimated_hours}h
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{option.description}</p>

        {/* Best For */}
        <div className="flex items-start gap-2 rounded-md bg-accent/50 px-3 py-2 text-sm">
          <Star className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
          <span>
            <span className="font-medium">Best for:</span>{" "}
            <span className="text-muted-foreground">{option.best_for}</span>
          </span>
        </div>

        {/* Stack */}
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Stack
          </p>
          <div className="flex flex-wrap gap-1.5">
            {option.stack.map((tech) => (
              <Badge key={tech} variant="outline" className="text-xs">
                {tech}
              </Badge>
            ))}
          </div>
        </div>

        {/* Pros & Cons */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-green-400">
              <ThumbsUp className="h-3 w-3" /> Pros
            </p>
            <ul className="space-y-1">
              {option.pros.map((pro, i) => (
                <li
                  key={i}
                  className="text-xs text-muted-foreground flex items-start gap-1"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-green-400" />
                  {pro}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-red-400">
              <ThumbsDown className="h-3 w-3" /> Cons
            </p>
            <ul className="space-y-1">
              {option.cons.map((con, i) => (
                <li
                  key={i}
                  className="text-xs text-muted-foreground flex items-start gap-1"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                  {con}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Choose Button */}
        <Button
          className="w-full"
          variant={selected ? "default" : "outline"}
          onClick={() => onSelect(option.id)}
          disabled={disabled}
        >
          <Zap className="h-4 w-4" />
          {selected ? "Selected" : "Choose This Architecture"}
        </Button>
      </CardContent>
    </Card>
  )
}
