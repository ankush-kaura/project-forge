import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ScoreBadge"
import type { Idea } from "@/types"
import { Tag } from "lucide-react"

interface IdeaCardProps {
  idea: Idea
}

const statusColors: Record<string, string> = {
  captured: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  analyzing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  analyzed: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  prioritized: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  launched: "bg-green-500/20 text-green-400 border-green-500/30",
  archived: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
}

export function IdeaCard({ idea }: IdeaCardProps) {
  const score = idea.priority?.final_score ?? idea.analysis?.viability_score

  return (
    <Link to={`/ideas/${idea.documentId}`}>
      <Card className="h-full transition-colors hover:bg-accent/50 cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base line-clamp-1">{idea.title}</CardTitle>
            {score != null && <ScoreBadge score={score} />}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {idea.description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={statusColors[idea.status] ?? statusColors.captured}
            >
              {idea.status}
            </Badge>
            {idea.category && (
              <Badge variant="outline" className="capitalize">
                {idea.category}
              </Badge>
            )}
            {(idea.tags ?? []).slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
            {(idea.tags ?? []).length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{idea.tags.length - 3}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
