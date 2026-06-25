import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { EngineIndicator } from "@/components/EngineIndicator"

/**
 * Component tests for the "Powered by Codex" engine indicator.
 *
 * The indicator reads `/api/forge/health` and renders the active analysis
 * provider reported by the backend. These tests mock `fetch` (incl. the codex
 * case) so they are deterministic and CI-safe (no live backend, no live LLM).
 */

type HealthResponse = {
  ok: boolean
  analysis: { provider: string; model: string; configured: boolean }
  codegen: { provider: string; model: string; configured: boolean }
  message: string
}

function mockHealthResponse(analysis: {
  provider: string
  model?: string
  configured?: boolean
}): HealthResponse {
  return {
    ok: true,
    analysis: {
      provider: analysis.provider,
      model: analysis.model ?? "test-model",
      configured: analysis.configured ?? true,
    },
    codegen: {
      provider: analysis.provider,
      model: analysis.model ?? "test-model",
      configured: analysis.configured ?? true,
    },
    message: `Analysis ${analysis.provider} configured`,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("EngineIndicator", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("renders the codex provider when health reports codex", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(mockHealthResponse({ provider: "codex", model: "gpt-5.1-codex" })))

    render(<EngineIndicator />)

    const indicator = await screen.findByTestId("engine-indicator")
    await waitFor(() => expect(indicator).toHaveAttribute("data-status", "ok"))
    expect(indicator).toHaveTextContent("codex")
    expect(indicator).toHaveAttribute("data-provider", "codex")
    // Visible text must contain the codex provider name.
    expect(screen.getByText(/codex/i)).toBeInTheDocument()
  })

  it("renders an alternate provider honestly (no fabricated codex)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(mockHealthResponse({ provider: "gemini", model: "gemini-2.5" })))

    render(<EngineIndicator />)

    const indicator = await screen.findByTestId("engine-indicator")
    await waitFor(() => expect(indicator).toHaveAttribute("data-status", "ok"))
    expect(indicator).toHaveTextContent("gemini")
    expect(indicator).toHaveAttribute("data-provider", "gemini")
    // Must NOT fabricate codex when health says gemini.
    expect(indicator.textContent?.toLowerCase()).not.toContain("codex")
  })

  it("degrades gracefully when the health request rejects (no crash, no fabricated provider)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"))

    render(<EngineIndicator />)

    const indicator = await screen.findByTestId("engine-indicator")
    await waitFor(() => expect(indicator).toHaveAttribute("data-status", "unavailable"))
    expect(indicator).toHaveTextContent(/unavailable/i)
    // No fabricated provider value.
    expect(indicator).not.toHaveAttribute("data-provider")
    expect(indicator.textContent?.toLowerCase()).not.toContain("codex")
  })

  it("degrades gracefully when health returns a non-ok HTTP status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("internal error", { status: 500, headers: { "Content-Type": "text/plain" } }),
    )

    render(<EngineIndicator />)

    const indicator = await screen.findByTestId("engine-indicator")
    await waitFor(() => expect(indicator).toHaveAttribute("data-status", "unavailable"))
    expect(indicator).toHaveTextContent(/unavailable/i)
    expect(indicator).not.toHaveAttribute("data-provider")
  })

  it("degrades gracefully when health JSON is missing the analysis provider", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ ok: false, analysis: { provider: "", model: "" } }),
    )

    render(<EngineIndicator />)

    const indicator = await screen.findByTestId("engine-indicator")
    await waitFor(() => expect(indicator).toHaveAttribute("data-status", "unavailable"))
    expect(indicator).toHaveTextContent(/unavailable/i)
    expect(indicator).not.toHaveAttribute("data-provider")
  })

  it("renders a loading state before the health request resolves", () => {
    // Never-resolving fetch keeps the component in the loading state.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<EngineIndicator />)

    const indicator = screen.getByTestId("engine-indicator")
    expect(indicator).toHaveAttribute("data-status", "loading")
    // Loading state shows no provider value.
    expect(indicator).not.toHaveAttribute("data-provider")
  })
})
