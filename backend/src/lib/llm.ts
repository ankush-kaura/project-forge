// @ts-nocheck
/**
 * Project Forge — unified LLM access layer.
 *
 * Replaces the old `execSync('gemini ...')` CLI-subprocess calls (which silently
 * failed inside the container and fell back to hardcoded mock data).
 *
 * The primary engine is the OpenAI **Codex CLI** (`codex exec`), invoked as a
 * subprocess. Gemini / OpenAI / Anthropic remain configurable HTTP alternates
 * (zero npm deps: the Node global `fetch` calls provider REST APIs directly).
 * Routes by task:
 *   - 'analysis' (analyse / brainstorm / Q&A / triage) -> ANALYSIS provider (default codex)
 *   - 'codegen'  (build-layer code generation)         -> CODEGEN provider (default codex)
 *
 * Config (env):
 *   LLM_PROVIDER           codex | gemini | openai | anthropic (analysis)   default: codex
 *   CODEGEN_PROVIDER       codex | gemini | openai | anthropic              default: <LLM_PROVIDER>
 *   CODEX_COMMAND          path/name of the codex binary                    default: codex
 *   CODEX_MODEL            model passed via `-m` (optional)
 *   CODEX_ANALYSIS_MODEL   analysis-task model override (falls back to CODEX_MODEL)
 *   CODEX_CODEGEN_MODEL    codegen-task model override  (falls back to CODEX_MODEL)
 *   CODEX_SANDBOX          codex `-s` sandbox policy                        default: read-only
 *   CODEX_TIMEOUT_MS       per-call timeout; child is killed by PID on expiry
 *   GEMINI_API_KEY         Google AI Studio key
 *   GEMINI_ANALYSIS_MODEL  default: gemini-2.0-flash
 *   CODEGEN_MODEL          default per provider (gemini-1.5-pro / gpt-4o / claude-sonnet)
 *   OPENAI_API_KEY         (+ optional OPENAI_BASE_URL for OpenAI-compatible gateways)
 *   ANTHROPIC_API_KEY
 *   MOCK_MODE=1            dev only: callers may fall back to mock generators
 *
 * Contract: callLLMJson() returns parsed JSON or THROWS loudly. It never
 * silently substitutes canned data — that was the original root-cause bug.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Task = 'analysis' | 'codegen';

async function runCli(command: string, prompt: string, timeoutMs: number): Promise<string> {
  const { exec } = await import('child_process');
  return await new Promise((resolve, reject) => {
    const child = exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`CLI provider failed: ${err.message}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`));
      else resolve(stdout.trim());
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/**
 * Invoke the Codex CLI non-interactively and return its final agent message.
 *
 * Shape:
 *   codex exec --json --output-schema <f> --output-last-message <f>
 *     -s <sandbox> --skip-git-repo-check [-m <model>] "<prompt>"
 *
 * The result is read from the --output-last-message file (most reliable); the
 * --json JSONL on stdout is captured only for diagnostics. The child is killed
 * by PID if it runs past `timeoutMs`, and a clear error is surfaced on failure.
 * Never substitutes mock data.
 */
async function runCodex(
  binary: string,
  prompt: string,
  opts: { model?: string; sandbox: string; timeoutMs: number; schema?: any },
): Promise<string> {
  const { spawn } = await import('child_process');
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-codex-'));
  const outFile = path.join(workDir, 'last-message.txt');
  await fs.promises.writeFile(outFile, '');

  const args = ['exec', '--json'];
  // The Responses API only accepts strict JSON Schemas (additionalProperties:false
  // with every field required), so a schema is passed only when the caller knows
  // the exact shape; otherwise codex returns free-form JSON we parse defensively.
  if (opts.schema) {
    const schemaFile = path.join(workDir, 'schema.json');
    await fs.promises.writeFile(schemaFile, JSON.stringify(opts.schema));
    args.push('--output-schema', schemaFile);
  }
  args.push('--output-last-message', outFile);
  args.push('-s', opts.sandbox, '--skip-git-repo-check');
  if (opts.model) args.push('-m', opts.model);
  args.push(prompt);

  const cleanup = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ } };

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } }
    }, opts.timeoutMs);

    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.stdout?.on('data', () => { /* JSONL diagnostics; result comes from outFile */ });

    child.on('error', (err: any) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`codex command failed to launch ("${binary}"): ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        cleanup();
        reject(new Error(`codex exec timed out after ${opts.timeoutMs}ms; child process killed`));
        return;
      }
      if (code !== 0) {
        cleanup();
        reject(new Error(`codex exec exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`));
        return;
      }
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch (e) {
        cleanup();
        reject(new Error(`codex exec produced no readable output: ${(e as Error).message}`));
        return;
      }
      cleanup();
      resolve(text);
    });
  });
}

export function providerFor(task: Task): string {
  if (task === 'codegen') {
    return (process.env.CODEGEN_PROVIDER || process.env.LLM_PROVIDER || 'codex').toLowerCase();
  }
  return (process.env.LLM_PROVIDER || 'codex').toLowerCase();
}

/** Explicitly-configured codex model for a task (undefined => let codex pick). */
function explicitCodexModel(task: Task): string | undefined {
  if (task === 'codegen') return process.env.CODEX_CODEGEN_MODEL || process.env.CODEX_MODEL || undefined;
  return process.env.CODEX_ANALYSIS_MODEL || process.env.CODEX_MODEL || undefined;
}

export function modelFor(task: Task, provider: string): string {
  if (provider === 'codex') return explicitCodexModel(task) || 'default';
  if (task === 'codegen' && process.env.CODEGEN_MODEL) return process.env.CODEGEN_MODEL;
  if (task === 'analysis' && provider === 'gemini' && process.env.GEMINI_ANALYSIS_MODEL) {
    return process.env.GEMINI_ANALYSIS_MODEL;
  }
  switch (provider) {
    case 'gemini': return task === 'codegen' ? 'gemini-1.5-pro' : 'gemini-2.0-flash';
    case 'openai': return task === 'codegen'
      ? (process.env.OPENAI_CODEGEN_MODEL || process.env.CODEGEN_MODEL || 'gpt-4o')
      : (process.env.OPENAI_ANALYSIS_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini');
    case 'anthropic': return task === 'codegen' ? 'claude-sonnet-4-5' : 'claude-3-5-haiku-latest';
    case 'custom-cli': return process.env.CUSTOM_LLM_MODEL || 'custom-cli';
    case 'factory-droid': return process.env.FACTORY_DROID_MODEL || 'factory-droid';
    default: return 'gpt-4o-mini';
  }
}

function codexCommand(): string {
  return process.env.CODEX_COMMAND || 'codex';
}

/**
 * Resolve the configured codex binary to an absolute executable path.
 * Returns the path when runnable, otherwise a human-readable reason. This is
 * what `configured` is based on — there is no API key for codex.
 */
function resolveCodexBinary(): { path?: string; reason?: string } {
  const cmd = codexCommand();
  if (cmd.includes('/') || cmd.includes(path.sep)) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      return { path: cmd };
    } catch {
      return { reason: `codex binary not found or not executable at "${cmd}" (set CODEX_COMMAND)` };
    }
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return { path: full };
    } catch { /* keep searching */ }
  }
  return { reason: `codex command "${cmd}" not found on PATH (set CODEX_COMMAND)` };
}

function keyFor(provider: string): string | undefined {
  switch (provider) {
    case 'codex': return resolveCodexBinary().path;
    case 'gemini': return process.env.GEMINI_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'custom-cli': return process.env.CUSTOM_LLM_COMMAND;
    case 'factory-droid': return process.env.FACTORY_DROID_COMMAND || process.env.CUSTOM_LLM_COMMAND;
    default: return undefined;
  }
}

/** Is a real provider configured for this task? */
export function llmConfigured(task: Task = 'analysis'): boolean {
  return Boolean(keyFor(providerFor(task)));
}

export function llmInfo(
  task: Task = 'analysis',
): { provider: string; model: string; configured: boolean; detail?: string } {
  const provider = providerFor(task);
  if (provider === 'codex') {
    const res = resolveCodexBinary();
    return {
      provider,
      model: modelFor(task, provider),
      configured: Boolean(res.path),
      ...(res.path ? {} : { detail: res.reason }),
    };
  }
  return { provider, model: modelFor(task, provider), configured: Boolean(keyFor(provider)) };
}

async function withTimeout(p: Promise<Response>, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
}

/** Low-level: send a prompt, get raw text back. Throws on transport/API error. */
export async function callLLM(
  prompt: string,
  opts: { task?: Task; maxTokens?: number; timeoutMs?: number; temperature?: number; schema?: any } = {},
): Promise<string> {
  const task = opts.task || 'analysis';
  const provider = providerFor(task);
  const model = modelFor(task, provider);
  const key = keyFor(provider);
  const timeoutMs = opts.timeoutMs || (task === 'codegen' ? 300000 : 120000);
  const maxTokens = opts.maxTokens || (task === 'codegen' ? 8192 : 2048);
  const temperature = opts.temperature ?? (task === 'codegen' ? 0.2 : 0.4);

  const isCliProvider = provider === 'custom-cli' || provider === 'factory-droid';
  if (!key) {
    if (provider === 'codex') {
      throw new Error(
        `codex provider not configured: ${resolveCodexBinary().reason}. ` +
        `Point CODEX_COMMAND at a runnable codex binary.`,
      );
    }
    const required = isCliProvider
      ? (provider === 'factory-droid' ? 'FACTORY_DROID_COMMAND or CUSTOM_LLM_COMMAND' : 'CUSTOM_LLM_COMMAND')
      : `${provider.toUpperCase()}_API_KEY`;
    throw new Error(
      `LLM not configured for task="${task}": set ${required} (provider=${provider}). ` +
      `See .env.example.`,
    );
  }

  if (provider === 'codex') {
    const sandbox = process.env.CODEX_SANDBOX || 'read-only';
    const codexTimeout = parseInt(process.env.CODEX_TIMEOUT_MS || '', 10) || timeoutMs;
    const text = await runCodex(key, prompt, {
      model: explicitCodexModel(task),
      sandbox,
      timeoutMs: codexTimeout,
      schema: opts.schema,
    });
    if (!text) throw new Error('codex exec returned an empty final message');
    return text;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: ac.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const data: any = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
      if (!text) throw new Error(`Gemini returned empty response: ${JSON.stringify(data).slice(0, 300)}`);
      return text;
    }

    if (provider === 'openai') {
      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: ac.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error(`OpenAI returned empty response`);
      return text;
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        signal: ac.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const data: any = await res.json();
      const text = data?.content?.map((b: any) => b.text || '').join('') ?? '';
      if (!text) throw new Error(`Anthropic returned empty response`);
      return text;
    }

    if (isCliProvider) {
      const text = await runCli(key, prompt, timeoutMs);
      if (!text) throw new Error(`${provider} returned empty response`);
      return text;
    }

    throw new Error(`Unknown LLM provider: ${provider}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first balanced JSON object/array from a model response. */
export function extractJson(text: string): any {
  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  // Find first { or [ and matching close by brace counting.
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return JSON.parse(body.slice(start, i + 1));
      }
    }
  }
  throw new Error(`Unbalanced JSON in response: ${text.slice(0, 200)}`);
}

/**
 * Send a prompt expecting JSON. Parses strictly; on parse failure does ONE
 * repair re-prompt, then throws. Never returns mock data.
 */
export async function callLLMJson(
  prompt: string,
  opts: { task?: Task; maxTokens?: number; timeoutMs?: number; schema?: any } = {},
): Promise<any> {
  const raw = await callLLM(prompt, opts);
  try {
    return extractJson(raw);
  } catch (e) {
    // One repair attempt: ask the model to return ONLY valid JSON.
    const repairPrompt =
      `The following response was supposed to be a single valid JSON value but could not be parsed ` +
      `(${(e as Error).message}). Re-emit ONLY the corrected JSON, no prose, no markdown fences:\n\n${raw.slice(0, 6000)}`;
    const repaired = await callLLM(repairPrompt, { ...opts, timeoutMs: 60000 });
    return extractJson(repaired); // throws if still bad — loud, by design
  }
}
