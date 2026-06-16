// @ts-nocheck
/**
 * Project Forge — build workspace + verification layer.
 *
 * The old pipeline wrote LLM output to ephemeral /tmp and NEVER ran/compiled
 * it, so "build_completed" meant nothing. This module:
 *   - writes generated files to a persistent workspace (mounted volume)
 *   - verifies a TypeScript/Node project: `npm install` + `tsc --noEmit`
 *   - returns captured stdout/stderr so the caller can feed failures back to
 *     the LLM (verify/repair loop)
 *
 * Verification runs as a child_process inside the backend container (the VPS
 * does not expose the Docker socket to this container, so an ephemeral sandbox
 * is a follow-up hardening — see docs). Resource use is bounded by a timeout.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Root of the persistent build workspace (mount a volume here in compose). */
export const BUILD_ROOT = process.env.FORGE_BUILD_ROOT || '/app/builds';

export function workspaceFor(session: string): string {
  return path.join(BUILD_ROOT, String(session).replace(/[^a-zA-Z0-9_-]/g, '_'));
}

/** Write {path,content} files into a workspace dir, creating subdirs.
 * LLM output is UNTRUSTED: every path is resolved and bounds-checked against the
 * workspace root so a hallucinated/adversarial path (e.g. '....//app/src/index.ts')
 * cannot escape the build dir and overwrite mounted backend source. */
export function writeFiles(dir: string, files: { path: string; content: string }[]): void {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  for (const f of files) {
    const rel = (f.path || '').replace(/^\/+/, '');
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) continue; // reject traversal
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content ?? '');
  }
}

/** Recursively read all files in a dir as {path,content}, skipping junk. */
export function readAllFiles(dir: string, maxBytes = 400_000): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', '.next', 'build', '.turbo', 'coverage']);
  const walk = (d: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else {
        try {
          const stat = fs.statSync(abs);
          if (stat.size > maxBytes) continue;
          out.push({ path: r, content: fs.readFileSync(abs, 'utf-8') });
        } catch { /* binary / unreadable — skip */ }
      }
    }
  };
  walk(dir, '');
  return out;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(cmd, args, { cwd, env: { ...process.env, CI: '1', npm_config_yes: 'true' } });
    const finish = (code: number) => { if (!done) { done = true; resolve({ code, out: out.slice(-12_000) }); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(124); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => { out += `\n[spawn error] ${e.message}`; clearTimeout(timer); finish(127); });
    child.on('close', (code) => { clearTimeout(timer); finish(code ?? 1); });
  });
}

export interface VerifyResult {
  ok: boolean;
  step: 'none' | 'install' | 'typecheck';
  log: string;
}

/**
 * Verify a generated Node/TypeScript project in `dir`.
 *  - if package.json exists: npm install
 *  - if tsconfig.json exists: npx tsc --noEmit
 * Returns ok=false with captured log on the first failing step so the caller
 * can re-prompt the LLM with the errors.
 */
export async function verifyTypeScript(dir: string, opts: { timeoutMs?: number } = {}): Promise<VerifyResult> {
  const installTimeout = opts.timeoutMs || 240_000;
  const checkTimeout = opts.timeoutMs || 180_000;
  const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
  const hasTs = fs.existsSync(path.join(dir, 'tsconfig.json'));

  if (!hasPkg && !hasTs) {
    return { ok: true, step: 'none', log: 'No package.json/tsconfig.json — nothing to verify (non-Node layer).' };
  }

  if (hasPkg) {
    // --ignore-scripts: LLM-authored package.json must not run pre/postinstall hooks (RCE in container).
    const install = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], dir, installTimeout);
    if (install.code !== 0) {
      return { ok: false, step: 'install', log: `npm install failed (exit ${install.code}):\n${install.out}` };
    }
  }

  if (hasTs) {
    const tc = await run('npx', ['--yes', 'tsc', '--noEmit', '--pretty', 'false'], dir, checkTimeout);
    if (tc.code !== 0) {
      return { ok: false, step: 'typecheck', log: `tsc --noEmit failed (exit ${tc.code}):\n${tc.out}` };
    }
  }

  return { ok: true, step: 'typecheck', log: 'Install + typecheck passed.' };
}
