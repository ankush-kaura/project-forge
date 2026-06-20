import { useState, useEffect, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArchitectureCard } from "@/components/ArchitectureCard"
import { QuestionCard } from "@/components/QuestionCard"
import { BuildProgress } from "@/components/BuildProgress"
import { RefinementPanel } from "@/components/RefinementPanel"
import {
  ArrowLeft,
  Brain,
  MessageSquare,
  Hammer,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import type {
  BrainstormSession,
  ClarifyingQuestion,
  BuildStep,
  BuildStatus,
  RefinementRequest,
} from "@/types"
import { API_URL } from "@/lib/api"

const API = API_URL

const statusLabels: Record<string, string> = {
  pending: "Pending",
  brainstorming: "Generating Architecture...",
  awaiting_architecture_approval: "Choose Architecture",
  qa_in_progress: "Answer Questions",
  qa_completed: "Q&A Complete",
  awaiting_plan_approval: "Review Plan",
  ready_to_build: "Ready to Build",
  building: "Building...",
  build_completed: "Build Complete",
  awaiting_review: "Awaiting Review",
  completed: "Completed",
  refining: "Refining...",
  failed: "Failed",
}

type BuildStatusLayer = {
  layer: string
  status: BuildStep["status"]
  files_count?: number
  output_summary?: string
  error?: string
}

export default function BrainstormPage() {
  const { id: ideaId } = useParams<{ id: string }>()
  const [session, setSession] = useState<BrainstormSession | null>(null)
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([])
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([])
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null)
  const [refinements, setRefinements] = useState<RefinementRequest[]>([])
  const [selectedOption, setSelectedOption] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionLoading, setActionLoading] = useState("")
  const sessionId = session?.documentId

  // Fetch session
  const fetchSession = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API}/api/brainstorm/${sessionId}`)
      const data = await res.json()
      if (data.data) setSession(data.data)
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load session") }
  }, [sessionId])

  // Trigger brainstorm
  const startBrainstorm = async () => {
    if (!ideaId) return
    setActionLoading("brainstorm")
    setError("")
    try {
      const res = await fetch(`${API}/api/brainstorm/${ideaId}`, { method: "POST" })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setSession(data.data.session || data.data)
      if (data.data.architecture_proposal) {
        setSession(prev => prev ? { ...prev, architecture_proposal: data.data.architecture_proposal } : prev)
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to start brainstorm") }
    setActionLoading("")
  }

  // Select architecture
  const chooseArchitecture = async (optionId: string) => {
    if (!session) return
    setSelectedOption(optionId)
    setActionLoading("choose")
    try {
      await fetch(`${API}/api/brainstorm/${session.documentId}/choose`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_id: optionId }),
      })
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to choose architecture") }
    setActionLoading("")
  }

  // Approve architecture
  const approveArchitecture = async () => {
    if (!session) return
    setActionLoading("approve-arch")
    try {
      await fetch(`${API}/api/brainstorm/${session.documentId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "architecture" }),
      })
      // Auto-generate questions
      await fetch(`${API}/api/brainstorm/${session.documentId}/questions/generate`, { method: "POST" })
      await fetchSession()
      await fetchQuestions()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to approve architecture") }
    setActionLoading("")
  }

  // Fetch questions
  const fetchQuestions = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API}/api/brainstorm/${sessionId}/questions`)
      const data = await res.json()
      if (data.data) setQuestions(data.data)
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load questions") }
  }, [sessionId])

  // Answer question
  const answerQuestion = async (questionId: string, answer: string) => {
    if (!session) return
    try {
      const res = await fetch(`${API}/api/brainstorm/${session.documentId}/questions/${questionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, answered_via: "web" }),
      })
      const data = await res.json()
      await fetchQuestions()
      if (data.data?.all_answered) await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save answer") }
  }

  // Approve plan
  const approvePlan = async () => {
    if (!session) return
    setActionLoading("approve-plan")
    try {
      await fetch(`${API}/api/brainstorm/${session.documentId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "plan" }),
      })
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to approve plan") }
    setActionLoading("")
  }

  // Fetch build status
  const fetchBuildStatus = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API}/api/build/${sessionId}/status`)
      const data = await res.json()
      if (data.data) {
        setBuildStatus(data.data)
        setBuildSteps(data.data.layers?.map((l: BuildStatusLayer, i: number) => ({
          documentId: `step-${i}`,
          layer: l.layer,
          status: l.status,
          files_generated: l.files_count ? Array(l.files_count).fill({ path: "", lines: 0 }) : undefined,
          output_summary: l.output_summary,
          error_message: l.error,
          order: i,
        })) || [])
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load build status") }
  }, [sessionId])

  // Start build
  const startBuild = async () => {
    if (!session) return
    setActionLoading("start-build")
    try {
      // Set default layers if not set
      if (!session.build_layers || session.build_layers.length === 0) {
        await fetch(`${API}/api/brainstorm/${session.documentId}/layers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layers: ["database_schema", "api_backend", "frontend", "auth", "docker", "tests", "docs"] }),
        })
      }
      await fetch(`${API}/api/build/${session.documentId}/start`, { method: "POST" })
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to start build") }
    setActionLoading("")
  }

  // Poll build status
  useEffect(() => {
    if (!session || session.status !== "building") return
    const interval = setInterval(fetchBuildStatus, 5000)
    return () => clearInterval(interval)
  }, [session, fetchBuildStatus])

  // Approve layer
  const approveLayer = async (layer: string) => {
    if (!session) return
    try {
      await fetch(`${API}/api/build/${session.documentId}/layer/${layer}/approve`, { method: "POST" })
      await fetchBuildStatus()
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to approve layer") }
  }

  // Regenerate layer
  const regenerateLayer = async (layer: string) => {
    if (!session) return
    try {
      await fetch(`${API}/api/build/${session.documentId}/layer/${layer}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "User requested regeneration" }),
      })
      await fetchBuildStatus()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to regenerate layer") }
  }

  // Push to GitHub
  const [pushing, setPushing] = useState(false)
  const pushToGithub = async () => {
    if (!session) return
    setPushing(true)
    try {
      const res = await fetch(`${API}/api/build/${session.documentId}/push`, { method: "POST" })
      const data = await res.json()
      if (data.data?.repo_url) {
        setSession(prev => prev ? { ...prev, generated_repo_url: data.data.repo_url } : prev)
      }
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to push to GitHub") }
    setPushing(false)
  }

  // Fetch refinements
  const fetchRefinements = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`${API}/api/refine/${sessionId}/history`)
      const data = await res.json()
      if (data.data) setRefinements(data.data)
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load refinements") }
  }, [sessionId])

  // Submit refinement
  const submitRefinement = async (requestText: string, targetLayers: string[]) => {
    if (!session) return
    try {
      await fetch(`${API}/api/refine/${session.documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_text: requestText, target_layers: targetLayers }),
      })
      await fetchRefinements()
      await fetchSession()
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to submit refinement") }
  }

  // Initial load — check for existing session or create one
  useEffect(() => {
    if (!ideaId) return
    const init = async () => {
      setLoading(true)
      try {
        // Check for existing brainstorm session via custom route; avoids GraphQL/REST relation permission issues.
        const activeRes = await fetch(`${API}/api/brainstorm/idea/${ideaId}/active`)
        const activeData = await activeRes.json()
        const activeSession = activeData?.data

        if (activeSession?.documentId) {
          const sessRes = await fetch(`${API}/api/brainstorm/${activeSession.documentId}`)
          const sessData = await sessRes.json()
          if (sessData.data) {
            setSession(sessData.data)
            setSelectedOption(sessData.data.chosen_architecture?.id || "")
          }
        }
      } catch (err) { setError(err instanceof Error ? err.message : "Failed to load brainstorm") }
      setLoading(false)
    }
    init()
  }, [ideaId])

  // Load questions when entering QA phase
  useEffect(() => {
    if (session?.status === "qa_in_progress" || session?.status === "qa_completed") {
      fetchQuestions()
    }
  }, [session?.status, fetchQuestions])

  // Load build status when building
  useEffect(() => {
    if (session?.status === "building" || session?.status === "build_completed" || session?.status === "awaiting_review") {
      fetchBuildStatus()
    }
  }, [session?.status, fetchBuildStatus])

  // Load refinements
  useEffect(() => {
    if (session) fetchRefinements()
  }, [sessionId, fetchRefinements, session])

  // Determine active tab
  const getActiveTab = () => {
    if (!session) return "architecture"
    const s = session.status
    if (["pending", "brainstorming", "awaiting_architecture_approval"].includes(s)) return "architecture"
    if (["qa_in_progress", "qa_completed", "awaiting_plan_approval"].includes(s)) return "qa"
    if (["ready_to_build", "building", "build_completed", "awaiting_review"].includes(s)) return "build"
    if (["completed", "refining"].includes(s)) return "refine"
    return "architecture"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link to={`/ideas/${ideaId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Back to Idea
          </Link>
          <h1 className="text-2xl font-bold">Brainstorm</h1>
          {session && (
            <Badge variant="outline">{statusLabels[session.status] || session.status}</Badge>
          )}
        </div>

        {!session && (
          <Button onClick={startBrainstorm} disabled={actionLoading === "brainstorm"}>
            {actionLoading === "brainstorm" ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...</>
            ) : (
              <><Brain className="h-4 w-4 mr-2" /> Start Brainstorm</>
            )}
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-4 flex items-center gap-2 text-red-400">
            <AlertCircle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {!session && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
            <Brain className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No active brainstorm session</p>
            <p className="text-sm text-muted-foreground">Click "Start Brainstorm" to begin AI-powered architecture planning</p>
          </CardContent>
        </Card>
      )}

      {session && (
        <Tabs defaultValue={getActiveTab()} value={getActiveTab()}>
          <TabsList>
            <TabsTrigger value="architecture" disabled={!["pending", "brainstorming", "awaiting_architecture_approval"].includes(session.status)}>
              <Brain className="h-4 w-4 mr-1" /> Architecture
            </TabsTrigger>
            <TabsTrigger value="qa" disabled={!["qa_in_progress", "qa_completed", "awaiting_plan_approval"].includes(session.status)}>
              <MessageSquare className="h-4 w-4 mr-1" /> Q&A
            </TabsTrigger>
            <TabsTrigger value="build" disabled={!["ready_to_build", "building", "build_completed", "awaiting_review"].includes(session.status)}>
              <Hammer className="h-4 w-4 mr-1" /> Build
            </TabsTrigger>
            <TabsTrigger value="refine" disabled={!["completed", "refining", "build_completed", "awaiting_review"].includes(session.status)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refine
            </TabsTrigger>
          </TabsList>

          {/* Architecture Tab */}
          <TabsContent value="architecture" className="space-y-4">
            {session.status === "brainstorming" && (
              <Card>
                <CardContent className="flex items-center justify-center py-8 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                  <span className="text-muted-foreground">Generating architecture proposals...</span>
                </CardContent>
              </Card>
            )}

            {session.architecture_proposal?.options && (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {session.architecture_proposal.options.map((opt) => (
                    <ArchitectureCard
                      key={opt.id}
                      option={opt}
                      selected={selectedOption === opt.id}
                      onSelect={chooseArchitecture}
                      disabled={actionLoading === "choose"}
                    />
                  ))}
                </div>

                {selectedOption && session.status === "awaiting_architecture_approval" && (
                  <div className="flex justify-center">
                    <Button onClick={approveArchitecture} disabled={actionLoading === "approve-arch"} size="lg">
                      {actionLoading === "approve-arch" ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Approving...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> Approve & Start Q&A</>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Q&A Tab */}
          <TabsContent value="qa" className="space-y-4">
            {/* Progress */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {questions.filter(q => q.status === "answered" || q.status === "skipped").length} / {questions.length} answered
              </p>
              {session.status === "qa_in_progress" && questions.length === 0 && (
                <Button size="sm" variant="outline" onClick={async () => {
                  setActionLoading("gen-questions")
                  await fetch(`${API}/api/brainstorm/${session.documentId}/questions/generate`, { method: "POST" })
                  await fetchQuestions()
                  setActionLoading("")
                }}>
                  {actionLoading === "gen-questions" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Generate Questions
                </Button>
              )}
            </div>

            {questions.map(q => (
              <QuestionCard
                key={q.documentId}
                question={q}
                onAnswer={answerQuestion}
              />
            ))}

            {/* Summary + Approve */}
            {session.status === "qa_completed" && (
              <Card className="border-green-500/30">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">All questions answered!</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Review your answers above, then approve to proceed to building.</p>
                  <Button onClick={approvePlan} disabled={actionLoading === "approve-plan"}>
                    {actionLoading === "approve-plan" ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Approving...</>
                    ) : (
                      "Approve Plan & Proceed to Build"
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Build Tab */}
          <TabsContent value="build" className="space-y-4">
            <BuildProgress
              steps={buildSteps}
              overallProgress={buildStatus?.progress || session.build_progress || 0}
              sessionStatus={session.status}
              onApproveLayer={approveLayer}
              onRegenerateLayer={regenerateLayer}
              onPush={pushToGithub}
              onStartBuild={startBuild}
              pushing={pushing}
              starting={actionLoading === "start-build"}
            />

            {session.generated_repo_url && (
              <Card className="border-green-500/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  <div>
                    <p className="font-medium">Pushed to GitHub!</p>
                    <a href={session.generated_repo_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline">
                      {session.generated_repo_url}
                    </a>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Refine Tab */}
          <TabsContent value="refine">
            <RefinementPanel
              sessionId={session.documentId}
              refinements={refinements}
              onSubmit={submitRefinement}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
