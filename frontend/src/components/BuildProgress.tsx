import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  RefreshCw,
  GitBranch,
} from "lucide-react"
import type { BuildStep, BuildStepStatus } from "@/types"

interface BuildProgressProps {
  steps: BuildStep[]
  overallProgress: number
  sessionStatus: string
  onApproveLayer: (layer: string) => void
  onRegenerateLayer: (layer: string) => void
  onPush: () => void
  onStartBuild: () => void
  pushing?: boolean
  starting?: boolean
}

const statusConfig: Record<BuildStepStatus, { icon: typeof Circle; color: string; label: string }> = {
  pending: { icon: Circle, color: "text-muted-foreground", label: "Pending" },
  generating: { icon: Loader2, color: "text-blue-400 animate-spin", label: "Generating" },
  completed: { icon: CheckCircle2, color: "text-yellow-400", label: "Awaiting Review" },
  failed: { icon: XCircle, color: "text-red-400", label: "Failed" },
  approved: { icon: CheckCircle2, color: "text-green-400", label: "Approved" },
  regenerating: { icon: RefreshCw, color: "text-orange-400 animate-spin", label: "Regenerating" },
}

const layerLabels: Record<string, string> = {
  database_schema: "Database Schema",
  api_backend: "API Backend",
  frontend: "Frontend",
  auth: "Authentication",
  docker: "Docker Config",
  tests: "Tests",
  docs: "Documentation",
}

export function BuildProgress({
  steps,
  overallProgress,
  sessionStatus,
  onApproveLayer,
  onRegenerateLayer,
  onPush,
  onStartBuild,
  pushing,
  starting,
}: BuildProgressProps) {
  const allApproved = steps.length > 0 && steps.every(s => s.status === "approved")
  const hasSteps = steps.length > 0
  const canStartBuild = sessionStatus === "ready_to_build" || sessionStatus === "build_completed" || !hasSteps

  return (
    <div className="space-y-4">
      {/* Overall Progress */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Build Progress</CardTitle>
            <Badge variant={allApproved ? "default" : "secondary"}>
              {overallProgress}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-muted rounded-full h-2.5 mb-4">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                allApproved ? "bg-green-500" : "bg-blue-500"
              }`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          {!hasSteps && (
            <Button onClick={onStartBuild} disabled={starting || !canStartBuild} className="w-full">
              {starting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...</>
              ) : (
                "Start Building"
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Layer Steps */}
      {hasSteps && (
        <div className="space-y-2">
          {steps.map((step) => {
            const config = statusConfig[step.status] || statusConfig.pending
            const Icon = config.icon
            const isCompleted = step.status === "completed"
            const isApproved = step.status === "approved"
            const isFailed = step.status === "failed"

            return (
              <Card key={step.layer} className={isApproved ? "border-green-500/30" : ""}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Icon className={`h-5 w-5 shrink-0 ${config.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {layerLabels[step.layer] || step.layer}
                        </p>
                        {step.output_summary && (
                          <p className="text-xs text-muted-foreground truncate">
                            {step.output_summary}
                          </p>
                        )}
                        {step.error_message && (
                          <p className="text-xs text-red-400">{step.error_message}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {step.files_generated && (
                        <Badge variant="outline" className="text-xs">
                          {Array.isArray(step.files_generated)
                            ? step.files_generated.length
                            : 0} files
                        </Badge>
                      )}

                      {isCompleted && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => onApproveLayer(step.layer)}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRegenerateLayer(step.layer)}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Regen
                          </Button>
                        </>
                      )}

                      {isFailed && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRegenerateLayer(step.layer)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}

                      {isApproved && (
                        <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Approved
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Push to GitHub */}
      {allApproved && (
        <Button onClick={onPush} disabled={pushing} className="w-full" size="lg">
          {pushing ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing...</>
          ) : (
            <><GitBranch className="h-4 w-4 mr-2" /> Push to GitHub</>
          )}
        </Button>
      )}
    </div>
  )
}
