import { useParams, Link } from "react-router-dom"
import { gql } from "@apollo/client"
import { useQuery } from "@apollo/client/react"
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScoreBadge } from "@/components/ScoreBadge"
import {
  ArrowLeft,
  Calendar,
  Tag,
  GitBranch,
  Star,
  StickyNote,
  Plus,
  Sparkles,
  SlidersHorizontal,
  FolderGit2,
  Brain,
} from "lucide-react"
import type { Idea } from "@/types"
import { API_URL } from "@/lib/api"

const IDEA_QUERY = gql`
  query Idea($id: ID!) {
    idea(documentId: $id) {
      documentId
      title
      description
      status
      tags
      category
      source
      analysis {
        viability_score
        problem_statement
        target_audience
        business_model
        revenue_potential
        technical_complexity
        dev_effort_hours
        risk_assessment
        market_opportunity
        createdAt
      }
      priority {
        revenue_score
        interest_score
        opportunity_score
        complexity_score
        final_score
        rank
        createdAt
      }
      repo {
        repo_name
        repo_url
        visibility
        github_created
      }
      notes {
        documentId
        content
        createdAt
        updatedAt
      }
      createdAt
      updatedAt
    }
  }
`

const statusColors: Record<string, string> = {
  captured: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  analyzing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  analyzed: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  prioritized: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  brainstorming: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  launched: "bg-green-500/20 text-green-400 border-green-500/30",
  archived: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
}

export default function IdeaDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, refetch } = useQuery<{ idea: Idea | null }, { id: string | undefined }>(IDEA_QUERY, {
    variables: { id },
    skip: !id,
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [prioritizing, setPrioritizing] = useState(false)
  const [generatingRepo, setGeneratingRepo] = useState(false)
  const [message, setMessage] = useState("")
  const [activeBrainstorm, setActiveBrainstorm] = useState<{ documentId: string; status: string } | null>(null)


  const handleAnalyze = async () => {
    setAnalyzing(true)
    setMessage("")
    try {
      const res = await fetch(`${API_URL}/api/ideas/${id}/analyze`, { method: "POST" })
      const result = await res.json()
      setMessage(result.data?.message || result.error || "Analysis complete")
      refetch()
    } catch { setMessage("Analysis failed") }
    setAnalyzing(false)
  }

  const handlePrioritize = async () => {
    setPrioritizing(true)
    setMessage("")
    try {
      const res = await fetch(`${API_URL}/api/ideas/${id}/prioritize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenue_score: 7, interest_score: 7, opportunity_score: 7, complexity_score: 5 }),
      })
      const result = await res.json()
      setMessage(result.data?.message || `Score: ${result.data?.final_score}`)
      refetch()
    } catch { setMessage("Prioritization failed") }
    setPrioritizing(false)
  }

  const handleGenerateRepo = async () => {
    setGeneratingRepo(true)
    setMessage("")
    try {
      const res = await fetch(`${API_URL}/api/ideas/${id}/generate-repo`, { method: "POST" })
      const result = await res.json()
      setMessage(result.data?.message || [result.error, result.detail].filter(Boolean).join(": ") || "Repo generated")
      refetch()
    } catch { setMessage("Repo generation failed") }
    setGeneratingRepo(false)
  }

  const idea: Idea | null = data?.idea ?? null

  useEffect(() => {
    if (!id) return
    fetch(`${API_URL}/api/brainstorm/idea/${id}/active`)
      .then((res) => res.ok ? res.json() : null)
      .then((json) => setActiveBrainstorm(json?.data ?? null))
      .catch(() => setActiveBrainstorm(null))
  }, [id])

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Loading...</div>
  }

  if (!idea) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Idea not found</p>
        <Link to="/ideas">
          <Button variant="outline" size="sm" className="mt-2">
            Back to Ideas
          </Button>
        </Link>
      </div>
    )
  }

  const score = idea.priority?.final_score ?? idea.analysis?.viability_score
  const hasActiveBrainstorm = Boolean(activeBrainstorm)
  const canBrainstorm = Boolean(idea.analysis || ["brainstorming", "building", "analyzed", "prioritized"].includes(idea.status))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            to="/ideas"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Ideas
          </Link>
          <h1 className="text-2xl font-bold">{idea.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={statusColors[idea.status] ?? statusColors.captured}>
              {idea.status}
            </Badge>
            {idea.category && (
              <Badge variant="secondary" className="capitalize">{idea.category}</Badge>
            )}
            {(idea.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>
        </div>
        {score != null && (
          <ScoreBadge score={score} className="text-lg px-3 py-1" />
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {!idea.analysis && (
          <Button onClick={handleAnalyze} disabled={analyzing} size="sm">
            <Sparkles className="h-4 w-4 mr-1" />
            {analyzing ? "Analyzing..." : "Analyze with AI"}
          </Button>
        )}
        {idea.analysis && !idea.priority && (
          <Button onClick={handlePrioritize} disabled={prioritizing} size="sm" variant="outline">
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            {prioritizing ? "Scoring..." : "Set Priority"}
          </Button>
        )}
        {!idea.repo && (
          <Button onClick={handleGenerateRepo} disabled={generatingRepo} size="sm" variant="outline">
            <FolderGit2 className="h-4 w-4 mr-1" />
            {generatingRepo ? "Generating..." : "Generate Repo"}
          </Button>
        )}
        {canBrainstorm && (
          <Link to={`/ideas/${id}/brainstorm`}>
            <Button size="sm" variant={hasActiveBrainstorm ? "default" : "outline"}>
              <Brain className="h-4 w-4 mr-1" />
              {hasActiveBrainstorm ? "Continue Brainstorm" : "Brainstorm & Build"}
            </Button>
          </Link>
        )}
        {message && (
          <span className="flex items-center text-sm text-green-400">{message}</span>
        )}
      </div>

      {/* Description */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground whitespace-pre-wrap">
            {idea.description || "No description provided."}
          </p>
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Created {new Date(idea.createdAt).toLocaleDateString()}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Updated {new Date(idea.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="analysis">
        <TabsList>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="priority">Priority</TabsTrigger>
          <TabsTrigger value="repo">Repo</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Analysis */}
        <TabsContent value="analysis">
          {idea.analysis ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Viability Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScoreBadge score={idea.analysis.viability_score ?? 0} className="text-2xl px-4 py-1.5" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Market Opportunity</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.market_opportunity}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Problem Statement</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.problem_statement}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Target Audience</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.target_audience}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Business Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.business_model}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Revenue Potential</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.revenue_potential}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Technical Complexity</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.technical_complexity}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Dev Effort (Hours)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{idea.analysis.dev_effort_hours ?? "N/A"}</p>
                </CardContent>
              </Card>
              <Card className="sm:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Risk Assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{idea.analysis.risk_assessment}</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-muted-foreground">No analysis yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Priority */}
        <TabsContent value="priority">
          {idea.priority ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="sm:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Final Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <ScoreBadge score={idea.priority.final_score ?? 0} className="text-2xl px-4 py-1.5" />
                    {idea.priority.rank && (
                      <Badge variant="outline">Rank #{idea.priority.rank}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Revenue Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{idea.priority.revenue_score ?? "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Interest Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{idea.priority.interest_score ?? "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Opportunity Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{idea.priority.opportunity_score ?? "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Complexity Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{idea.priority.complexity_score ?? "—"}</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-muted-foreground">No priority scored yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Repo */}
        <TabsContent value="repo">
          {idea.repo ? (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={idea.repo.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {idea.repo.repo_name}
                  </a>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {idea.repo.visibility && (
                    <span className="flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${idea.repo.visibility === 'public' ? 'bg-green-400' : 'bg-zinc-400'}`} />
                      {idea.repo.visibility}
                    </span>
                  )}
                  {idea.repo.github_created && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      GitHub
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-muted-foreground">No repository linked</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Notes */}
        <TabsContent value="notes">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {(idea.notes ?? []).length} note{(idea.notes ?? []).length !== 1 ? "s" : ""}
              </h3>
              <Button variant="outline" size="sm">
                <Plus className="h-3 w-3" />
                Add Note
              </Button>
            </div>
            <Textarea placeholder="Write a note..." rows={3} />
            {(idea.notes ?? []).length === 0 ? (
              <Card>
                <CardContent className="flex h-24 items-center justify-center">
                  <p className="text-muted-foreground flex items-center gap-2">
                    <StickyNote className="h-4 w-4" />
                    No notes yet
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {(idea.notes ?? []).map((note) => (
                  <Card key={note.documentId}>
                    <CardContent className="pt-4">
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {new Date(note.updatedAt ?? note.createdAt).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
