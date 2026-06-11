import { gql } from "@apollo/client"
import { useQuery } from "@apollo/client/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ScoreBadge"
import { Link } from "react-router-dom"
import { SlidersHorizontal } from "lucide-react"
import type { Idea } from "@/types"

const IDEAS_QUERY = gql`
  query Ideas {
    ideas(sort: "updatedAt:desc", pagination: { limit: 100 }) {
      documentId
      title
      description
      status
      tags
      category
      analysis {
        viability_score
      }
      priority {
        revenue_score
        interest_score
        opportunity_score
        complexity_score
        final_score
        rank
      }
      createdAt
      updatedAt
    }
  }
`

export default function Priority() {
  const { data, loading } = useQuery<{ ideas: Idea[] }>(IDEAS_QUERY)

  const ideas: Idea[] = (data?.ideas ?? [])
    .filter((i: Idea) => i.priority?.final_score != null || i.analysis?.viability_score != null)
    .sort((a: Idea, b: Idea) => {
      const scoreA = a.priority?.final_score ?? a.analysis?.viability_score ?? 0
      const scoreB = b.priority?.final_score ?? b.analysis?.viability_score ?? 0
      return scoreB - scoreA
    })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Priorities</h1>
        <p className="text-muted-foreground">Rank and weight your ideas</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Info Panel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Priority Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Scoring Formula</p>
              <p>
                Final Score = (Revenue + Interest + Opportunity) ÷ Complexity
              </p>
              <p className="mt-2">
                Each factor is rated 1-10. Higher is better, except complexity (lower is better).
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">Score Ranges:</p>
              <ul className="space-y-1">
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  80-100: High Priority
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow-500" />
                  50-79: Medium Priority
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  0-49: Low Priority
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Ranked List */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-muted-foreground">Loading...</p>
              </CardContent>
            </Card>
          ) : ideas.length === 0 ? (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-muted-foreground">
                  No scored ideas yet.{" "}
                  <Link to="/ideas/new" className="text-primary underline">
                    Create and analyze one
                  </Link>
                </p>
              </CardContent>
            </Card>
          ) : (
            ideas.map((idea, i) => {
              const score = idea.priority?.final_score ?? idea.analysis?.viability_score ?? 0
              return (
                <Link key={idea.documentId} to={`/ideas/${idea.documentId}`}>
                  <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                    <CardContent className="flex items-center gap-4 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{idea.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {idea.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {idea.status}
                        </Badge>
                        <ScoreBadge score={score} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
