import { gql } from "@apollo/client"
import { useQuery } from "@apollo/client/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { IdeaCard } from "@/components/IdeaCard"
import { ScoreBadge } from "@/components/ScoreBadge"
import { Link } from "react-router-dom"
import {
  Lightbulb,
  FlaskConical,
  Rocket,
  Hammer,
  TrendingUp,
  ArrowRight,
} from "lucide-react"
import type { Idea } from "@/types"

const DASHBOARD_QUERY = gql`
  query Dashboard {
    ideas(sort: "updatedAt:desc", pagination: { limit: 50 }) {
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
        final_score
        rank
      }
      createdAt
      updatedAt
    }
  }
`

export default function Dashboard() {
  const { data, loading } = useQuery<{ ideas: Idea[] }>(DASHBOARD_QUERY)

  const ideas: Idea[] = data?.ideas ?? []
  const totalIdeas = ideas.length
  const inResearch = ideas.filter((i) => ["analyzed", "prioritized"].includes(i.status)).length
  const launched = ideas.filter((i) => i.status === "launched").length
  const building = ideas.filter((i) => i.status === "building").length
  const scores = ideas
    .map((i) => i.priority?.final_score ?? i.analysis?.viability_score)
    .filter((s): s is number => s != null)
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0

  const topPriorities = [...ideas]
    .sort((a, b) => (b.priority?.final_score ?? 0) - (a.priority?.final_score ?? 0))
    .slice(0, 5)

  const recentIdeas = ideas.slice(0, 4)

  const stats = [
    {
      label: "Total Ideas",
      value: totalIdeas,
      icon: Lightbulb,
      color: "text-blue-400",
    },
    {
      label: "In Research",
      value: inResearch,
      icon: FlaskConical,
      color: "text-purple-400",
    },
    {
      label: "Building",
      value: building,
      icon: Hammer,
      color: "text-yellow-400",
    },
    {
      label: "Launched",
      value: launched,
      icon: Rocket,
      color: "text-green-400",
    },
    {
      label: "Avg Score",
      value: avgScore,
      icon: TrendingUp,
      color: "text-orange-400",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Your ideas at a glance</p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{loading ? "—" : stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Priorities */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Top Priorities</CardTitle>
            <Link
              to="/priorities"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {topPriorities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ideas yet</p>
            ) : (
              <div className="space-y-3">
                {topPriorities.map((idea, i) => (
                  <div
                    key={idea.documentId}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
                        {i + 1}
                      </span>
                      <Link
                        to={`/ideas/${idea.documentId}`}
                        className="text-sm font-medium truncate hover:underline"
                      >
                        {idea.title}
                      </Link>
                    </div>
                    {(idea.priority?.final_score ?? idea.analysis?.viability_score) != null && (
                      <ScoreBadge score={idea.priority?.final_score ?? idea.analysis?.viability_score ?? 0} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Chart Placeholder */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {["captured", "analyzing", "analyzed", "prioritized", "building", "launched"].map((stage) => {
                const count = ideas.filter((i) => i.status === stage).length
                const width = totalIdeas > 0 ? (count / totalIdeas) * 100 : 0
                return (
                  <div key={stage} className="flex items-center gap-2">
                    <span className="text-xs w-20 text-muted-foreground capitalize">{stage}</span>
                    <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full bg-primary rounded transition-all"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="text-xs w-6 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Ideas */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Ideas</h2>
          <Link
            to="/ideas"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentIdeas.length === 0 ? (
          <Card>
            <CardContent className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground">
                No ideas yet.{" "}
                <Link to="/ideas/new" className="text-primary underline">
                  Create one
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recentIdeas.map((idea) => (
              <IdeaCard key={idea.documentId} idea={idea} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
