import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Loader2, Send, History, Layers } from "lucide-react"
import type { RefinementRequest } from "@/types"

interface RefinementPanelProps {
  sessionId: string
  refinements: RefinementRequest[]
  onSubmit: (requestText: string, targetLayers: string[]) => Promise<void>
}

const AVAILABLE_LAYERS = [
  { id: "database_schema", label: "Database" },
  { id: "api_backend", label: "API Backend" },
  { id: "frontend", label: "Frontend" },
  { id: "auth", label: "Auth" },
  { id: "docker", label: "Docker" },
  { id: "tests", label: "Tests" },
  { id: "docs", label: "Docs" },
]

export function RefinementPanel({ refinements, onSubmit }: RefinementPanelProps) {
  const [requestText, setRequestText] = useState("")
  const [targetLayers, setTargetLayers] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const toggleLayer = (layer: string) => {
    setTargetLayers(prev =>
      prev.includes(layer) ? prev.filter(l => l !== layer) : [...prev, layer]
    )
  }

  const handleSubmit = async () => {
    if (!requestText.trim()) return
    setSubmitting(true)
    await onSubmit(requestText, targetLayers)
    setRequestText("")
    setTargetLayers([])
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      {/* Submit Refinement */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Request Refinement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Describe what you want to change... (e.g., 'Add a comment system', 'Change auth to GitHub OAuth', 'Add real-time notifications')"
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            rows={3}
          />

          <div>
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Layers className="h-3 w-3" />
              Target layers (leave empty for AI to determine):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_LAYERS.map(layer => (
                <Badge
                  key={layer.id}
                  variant={targetLayers.includes(layer.id) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleLayer(layer.id)}
                >
                  {layer.label}
                </Badge>
              ))}
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={submitting || !requestText.trim()} className="w-full">
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Submit Refinement</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Refinement History */}
      {refinements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Iteration History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {refinements.map(ref => (
                <div key={ref.documentId} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">Iteration #{ref.iteration_number}</Badge>
                    <Badge variant={
                      ref.status === "completed" ? "default" :
                      ref.status === "failed" ? "destructive" : "secondary"
                    }>
                      {ref.status}
                    </Badge>
                  </div>
                  <p className="text-sm">{ref.request_text}</p>
                  {ref.impact_analysis && (
                    <p className="text-xs text-muted-foreground">{ref.impact_analysis}</p>
                  )}
                  {ref.target_layers && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {ref.target_layers.map(l => (
                        <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// TODO: Add loading skeleton and optimistic updates for refinement submissions
// WIP - exploring UX improvements for the refinement request flow
