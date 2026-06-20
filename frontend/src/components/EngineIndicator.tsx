import { useEffect, useState } from "react"
import { Zap } from "lucide-react"
import { API_URL } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Honest "Powered by Codex" engine indicator.
 *
 * Reads `/api/forge/health` and renders the *actual* active analysis provider +
 * model reported by the backend (e.g. "Engine: codex"). It never fabricates a
 * provider: when health is unreachable or malformed the indicator falls back to a
 * neutral "unavailable" state instead of inventing a value, and never crashes the
 * surrounding app shell.
 */

type HealthResponse = {
  ok?: boolean
  analysis?: { provider?: string; model?: string; configured?: boolean }
}

type IndicatorStatus = "loading" | "ok" | "unavailable"

export function EngineIndicator({ className }: { className?: string }) {
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState<string>("")
  const [status, setStatus] = useState<IndicatorStatus>("loading")

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/forge/health`)
        if (!res.ok) throw new Error(`health ${res.status}`)
        const json: HealthResponse = await res.json()
        if (cancelled) return
        const p = json?.analysis?.provider
        if (typeof p === "string" && p.length > 0) {
          setProvider(p)
          setModel(typeof json.analysis?.model === "string" ? json.analysis.model : "")
          setStatus("ok")
        } else {
          setProvider(null)
          setModel("")
          setStatus("unavailable")
        }
      } catch {
        if (cancelled) return
        setProvider(null)
        setModel("")
        setStatus("unavailable")
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const base =
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold whitespace-nowrap"

  if (status === "unavailable") {
    return (
      <span
        className={cn(
          base,
          "border-muted text-muted-foreground bg-muted/30",
          className,
        )}
        data-testid="engine-indicator"
        data-status="unavailable"
        title="AI engine status unavailable"
      >
        <Zap className="h-3.5 w-3.5" />
        Engine: unavailable
      </span>
    )
  }

  if (status === "loading" || !provider) {
    return (
      <span
        className={cn(
          base,
          "border-muted text-muted-foreground bg-muted/30",
          className,
        )}
        data-testid="engine-indicator"
        data-status="loading"
        title="Loading AI engine status"
      >
        <Zap className="h-3.5 w-3.5" />
        Engine: …
      </span>
    )
  }

  return (
    <span
      className={cn(
        base,
        "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
      data-testid="engine-indicator"
      data-status="ok"
      data-provider={provider}
      title={`Analysis engine: ${provider}${model ? ` / ${model}` : ""}`}
    >
      <Zap className="h-3.5 w-3.5" />
      <span>Engine: {provider}</span>
    </span>
  )
}
