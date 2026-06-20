import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Activity, CheckCircle2, RefreshCw, XCircle } from "lucide-react"
import { API_URL } from "@/lib/api"

type ProviderInfo = { provider: string; model: string; configured: boolean }
type GithubInfo = { configured: boolean; token_source?: string | null; owner?: string | null; reason?: string }
type Health = {
  ok: boolean
  analysis: ProviderInfo
  codegen: ProviderInfo
  github: GithubInfo
  deploy_enabled: boolean
  mock_mode: boolean
  message: string
}

const API = API_URL

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
  ) : (
    <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Missing</Badge>
  )
}

function ProviderCard({ title, info }: { title: string; info: ProviderInfo }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          {title}
          <StatusBadge ok={info.configured} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div><span className="text-muted-foreground">Provider:</span> {info.provider}</div>
        <div><span className="text-muted-foreground">Model:</span> {info.model}</div>
      </CardContent>
    </Card>
  )
}

export default function HealthPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API}/api/forge/health`)
      const json = await res.json()
      setHealth(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> Forge Health</h1>
          <p className="text-muted-foreground">LLM, codegen, GitHub, and deploy configuration</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && <Card className="border-red-500/30"><CardContent className="pt-4 text-red-400">{error}</CardContent></Card>}

      {health && (
        <>
          <Card className={health.ok ? "border-green-500/30" : "border-yellow-500/30"}>
            <CardContent className="pt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">Overall: {health.ok ? "Ready" : "Needs configuration"}</div>
                <div className="text-sm text-muted-foreground">{health.message}</div>
              </div>
              <StatusBadge ok={health.ok} />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <ProviderCard title="Analysis LLM" info={health.analysis} />
            <ProviderCard title="Codegen LLM" info={health.codegen} />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center justify-between">GitHub <StatusBadge ok={health.github.configured} /></CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Owner:</span> {health.github.owner || "Not set"}</div>
                <div><span className="text-muted-foreground">Token:</span> {health.github.token_source || "Not set"}</div>
                {health.github.reason && <div className="text-yellow-400">{health.github.reason}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Runtime Flags</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Mock mode:</span> {health.mock_mode ? "on" : "off"}</div>
                <div><span className="text-muted-foreground">Deploy enabled:</span> {health.deploy_enabled ? "yes" : "no"}</div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
