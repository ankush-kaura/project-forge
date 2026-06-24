// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { providerFor, modelFor, llmInfo, llmConfigured, callLLM, callLLMJson } from '../src/lib/llm';

const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-codex');

const CODEX_ENV_KEYS = [
  'LLM_PROVIDER', 'CODEGEN_PROVIDER', 'CODEGEN_MODEL',
  'CODEX_COMMAND', 'CODEX_MODEL', 'CODEX_ANALYSIS_MODEL', 'CODEX_CODEGEN_MODEL',
  'CODEX_SANDBOX', 'CODEX_TIMEOUT_MS',
  'CODEX_FAKE_OUTPUT', 'CODEX_FAKE_OUTPUTS', 'CODEX_FAKE_COUNTER_FILE',
  'CODEX_FAKE_SLEEP_MS', 'CODEX_FAKE_EXIT_CODE', 'CODEX_ARGV_LOG',
  'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MOCK_MODE',
];

let tmpDir: string;
let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of CODEX_ENV_KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
  // Point the provider at the deterministic fake codex by default.
  process.env.CODEX_COMMAND = FAKE_CODEX;
});

afterEach(() => {
  for (const k of CODEX_ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function readArgvLog(file: string): string[][] {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('codex provider defaults', () => {
  it('defaults to codex for analysis and codegen (VAL-CODEX-001/002/003)', () => {
    expect(providerFor('analysis')).toBe('codex');
    expect(providerFor('codegen')).toBe('codex');
  });

  it('reports configured=true with a non-empty model when the binary resolves (VAL-CODEX-004/005)', () => {
    const info = llmInfo('analysis');
    expect(info.provider).toBe('codex');
    expect(info.configured).toBe(true);
    expect(typeof info.model).toBe('string');
    expect(info.model.length).toBeGreaterThan(0);
    expect(llmConfigured('codegen')).toBe(true);
  });

  it('reports configured=false with a reason when the binary is missing (VAL-CODEX-006)', () => {
    process.env.CODEX_COMMAND = '/nonexistent/codex-binary-xyz';
    const info = llmInfo('analysis');
    expect(info.provider).toBe('codex');
    expect(info.configured).toBe(false);
    expect(String(info.detail || '')).toMatch(/codex/i);
  });
});

describe('codex invocation flags', () => {
  it('invokes codex exec with --json, --output-schema, --output-last-message, sandbox + skip-git (VAL-CODEX-010/011)', async () => {
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;
    process.env.CODEX_FAKE_OUTPUT = '{"problem_statement":"x","viability_score":81}';

    const result = await callLLMJson('analyze this idea', {
      task: 'analysis',
      schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    });
    expect(result).toEqual({ problem_statement: 'x', viability_score: 81 });

    const calls = readArgvLog(argvLog);
    expect(calls.length).toBe(1);
    const argv = calls[0];
    expect(argv[0]).toBe('exec');
    expect(argv).toContain('--json');
    expect(argv).toContain('--output-schema');
    expect(argv).toContain('--output-last-message');
    expect(argv).toContain('--skip-git-repo-check');
    const sIdx = argv.indexOf('-s');
    expect(sIdx).toBeGreaterThanOrEqual(0);
    expect(argv[sIdx + 1]).toBe('read-only');
    // the prompt is the final argument
    expect(argv[argv.length - 1]).toBe('analyze this idea');
  });

  it('omits --output-schema when the caller provides no schema (free-form, live-safe)', async () => {
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;
    process.env.CODEX_FAKE_OUTPUT = '{"ok":true}';
    await callLLMJson('free form please', { task: 'analysis' });
    const argv = readArgvLog(argvLog)[0];
    expect(argv).not.toContain('--output-schema');
    expect(argv).toContain('--json');
    expect(argv).toContain('--output-last-message');
    expect(argv).toContain('--skip-git-repo-check');
  });

  it('honors CODEX_SANDBOX override', async () => {
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;
    process.env.CODEX_SANDBOX = 'workspace-write';
    await callLLM('hi', { task: 'analysis' });
    const argv = readArgvLog(argvLog)[0];
    expect(argv[argv.indexOf('-s') + 1]).toBe('workspace-write');
  });
});

describe('codex model overrides (VAL-CODEX-033)', () => {
  it('passes -m and reports the model when CODEX_MODEL is set', async () => {
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;
    process.env.CODEX_MODEL = 'gpt-5-codex';

    expect(modelFor('analysis', 'codex')).toBe('gpt-5-codex');
    expect(llmInfo('analysis').model).toBe('gpt-5-codex');

    await callLLM('hi', { task: 'analysis' });
    const argv = readArgvLog(argvLog)[0];
    const mIdx = argv.indexOf('-m');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(argv[mIdx + 1]).toBe('gpt-5-codex');
  });

  it('CODEX_ANALYSIS_MODEL overrides CODEX_MODEL for analysis', async () => {
    process.env.CODEX_MODEL = 'base-model';
    process.env.CODEX_ANALYSIS_MODEL = 'analysis-model';
    expect(modelFor('analysis', 'codex')).toBe('analysis-model');
    expect(modelFor('codegen', 'codex')).toBe('base-model');
  });

  it('does not pass -m when no model is configured', async () => {
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;
    await callLLM('hi', { task: 'analysis' });
    const argv = readArgvLog(argvLog)[0];
    expect(argv).not.toContain('-m');
  });
});

describe('codex JSON parsing + repair semantics', () => {
  it('returns parsed JSON read from the output-last-message file (VAL-CODEX-011)', async () => {
    process.env.CODEX_FAKE_OUTPUT = '{"viability_score":77,"revenue_potential":"high"}';
    const out = await callLLMJson('p', { task: 'analysis' });
    expect(out.viability_score).toBe(77);
    expect(out.revenue_potential).toBe('high');
  });

  it('throws (no mock fallback) on persistently invalid JSON after one repair (VAL-CODEX-013/014)', async () => {
    const counter = path.join(tmpDir, 'counter');
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_FAKE_COUNTER_FILE = counter;
    process.env.CODEX_ARGV_LOG = argvLog;
    // Both the first call and the single repair return garbage.
    process.env.CODEX_FAKE_OUTPUTS = 'not json at all\u0001still not json';

    await expect(callLLMJson('p', { task: 'analysis' })).rejects.toThrow();
    // Exactly two invocations: original + one repair.
    expect(readArgvLog(argvLog).length).toBe(2);
  });

  it('recovers when the repair call returns valid JSON (VAL-CODEX-015)', async () => {
    const counter = path.join(tmpDir, 'counter');
    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_FAKE_COUNTER_FILE = counter;
    process.env.CODEX_ARGV_LOG = argvLog;
    process.env.CODEX_FAKE_OUTPUTS = 'garbage{\u0001{"viability_score":90}';

    const out = await callLLMJson('p', { task: 'analysis' });
    expect(out.viability_score).toBe(90);
    expect(readArgvLog(argvLog).length).toBe(2);
  });
});

describe('codex failure modes', () => {
  it('surfaces a clear error naming codex when the binary is missing (VAL-CODEX-016)', async () => {
    process.env.CODEX_COMMAND = '/nonexistent/codex-binary-xyz';
    await expect(callLLM('p', { task: 'analysis' })).rejects.toThrow(/codex/i);
  });

  it('kills the child and rejects on CODEX_TIMEOUT_MS expiry (VAL-CODEX-012)', async () => {
    process.env.CODEX_FAKE_SLEEP_MS = '5000';
    process.env.CODEX_TIMEOUT_MS = '300';
    const start = Date.now();
    await expect(callLLM('p', { task: 'analysis' })).rejects.toThrow(/timed out|timeout/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('surfaces a clear error when codex exits non-zero', async () => {
    process.env.CODEX_FAKE_EXIT_CODE = '7';
    await expect(callLLM('p', { task: 'analysis' })).rejects.toThrow(/codex/i);
  });
});

describe('config-only provider switching is preserved', () => {
  it('switches analysis provider to gemini via LLM_PROVIDER (VAL-CODEX-017)', () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'k';
    const info = llmInfo('analysis');
    expect(info.provider).toBe('gemini');
    expect(info.configured).toBe(true);
  });

  it('switches analysis provider to openai via LLM_PROVIDER (VAL-CODEX-018)', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'k';
    const info = llmInfo('analysis');
    expect(info.provider).toBe('openai');
    expect(info.configured).toBe(true);
  });

  it('switches analysis provider to anthropic via LLM_PROVIDER (VAL-CODEX-019)', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'k';
    const info = llmInfo('analysis');
    expect(info.provider).toBe('anthropic');
    expect(info.configured).toBe(true);
  });

  it('codegen provider switches independently of analysis via CODEGEN_PROVIDER (VAL-CODEX-020)', () => {
    process.env.CODEGEN_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'k';
    const analysis = llmInfo('analysis');
    const codegen = llmInfo('codegen');
    expect(analysis.provider).toBe('codex');
    expect(analysis.configured).toBe(true);
    expect(codegen.provider).toBe('openai');
    expect(codegen.configured).toBe(true);
  });
});

describe.skipIf(process.env.FORGE_LIVE_CODEX !== '1')('live codex smoke', () => {
  it('runs real codex exec and returns parsed JSON', async () => {
    delete process.env.CODEX_COMMAND; // use the real codex on PATH
    const out = await callLLMJson(
      'Respond with a JSON object describing a word, e.g. {"word":"forge"}.',
      {
        task: 'analysis',
        timeoutMs: 120000,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { word: { type: 'string' } },
          required: ['word'],
        },
      },
    );
    expect(out).toBeTypeOf('object');
    expect(typeof out.word).toBe('string');
  }, 130000);
});
