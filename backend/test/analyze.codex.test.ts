// @ts-nocheck
/**
 * Analyze-path contract tests.
 *
 * The POST /api/ideas/:id/analyze endpoint (backend/src/index.ts) drives the LLM
 * via `callLLMJson(prompt, { task: 'analysis', schema: ANALYSIS_SCHEMA })`. These
 * tests pin that exact contract against the deterministic fake codex so the
 * analyze path is provably codex-sourced (not the mock generator) and passes the
 * strict analysis schema. The full HTTP round-trip is exercised separately via
 * curl against a running backend (VAL-CODEX-007/008/009/032).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { providerFor, callLLMJson } from '../src/lib/llm';

const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-codex');

// Mirror of the strict schema the analyze endpoint sends to codex.
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problem_statement: { type: 'string' },
    target_audience: { type: 'string' },
    business_model: { type: 'string' },
    revenue_potential: { type: 'string', enum: ['low', 'medium', 'high'] },
    technical_complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    dev_effort_hours: { type: 'integer' },
    risk_assessment: { type: 'string' },
    market_opportunity: { type: 'string' },
    viability_score: { type: 'integer' },
  },
  required: [
    'problem_statement', 'target_audience', 'business_model', 'revenue_potential',
    'technical_complexity', 'dev_effort_hours', 'risk_assessment', 'market_opportunity',
    'viability_score',
  ],
};

const ENV_KEYS = [
  'LLM_PROVIDER', 'CODEGEN_PROVIDER', 'CODEX_COMMAND', 'CODEX_MODEL',
  'CODEX_ANALYSIS_MODEL', 'CODEX_SANDBOX', 'CODEX_TIMEOUT_MS',
  'CODEX_FAKE_OUTPUT', 'CODEX_FAKE_OUTPUTS', 'CODEX_FAKE_COUNTER_FILE',
  'CODEX_ARGV_LOG', 'MOCK_MODE',
];

let tmpDir: string;
let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) { snapshot[k] = process.env[k]; delete process.env[k]; }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-test-'));
  process.env.CODEX_COMMAND = FAKE_CODEX;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('analyze path drives codex with the analysis schema', () => {
  it('analysis task resolves to codex by default (no provider env set)', () => {
    expect(providerFor('analysis')).toBe('codex');
  });

  it('returns a populated, codex-sourced analysis (VAL-CODEX-007/008)', async () => {
    const marker = 'FAKE_CODEX_FIXTURE_MARKER_7f3a';
    const fixture = {
      problem_statement: `${marker}: users lack a unified idea workflow`,
      target_audience: 'indie founders',
      business_model: 'SaaS subscription',
      revenue_potential: 'high',
      technical_complexity: 'medium',
      dev_effort_hours: 320,
      risk_assessment: 'moderate',
      market_opportunity: 'growing AI tooling market',
      viability_score: 84,
    };
    process.env.CODEX_FAKE_OUTPUT = JSON.stringify(fixture);

    const argvLog = path.join(tmpDir, 'argv.log');
    process.env.CODEX_ARGV_LOG = argvLog;

    const data = await callLLMJson('Analyze this startup idea ...', {
      task: 'analysis',
      schema: ANALYSIS_SCHEMA,
    });

    // Populated analysis fields (VAL-CODEX-007 shape).
    expect(typeof data.problem_statement).toBe('string');
    expect(data.problem_statement.length).toBeGreaterThan(0);
    expect(data.viability_score).toBe(84);
    expect(['low', 'medium', 'high']).toContain(data.revenue_potential);

    // Proves the value came from codex (the echoed fixture marker), not the mock
    // generator whose raw_ai_output carries "Mock analysis" (VAL-CODEX-008).
    expect(data.problem_statement).toContain(marker);
    expect(JSON.stringify(data)).not.toContain('Mock analysis');

    // The analyze endpoint supplies a strict schema, so codex is invoked with
    // --output-schema (VAL-CODEX-011) on the analysis call.
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8').trim().split('\n')[0]);
    expect(argv).toContain('--output-schema');
    expect(argv).toContain('--output-last-message');
    expect(argv).toContain('--skip-git-repo-check');
  });

  it('throws loudly on unparseable codex output with no mock fallback (MOCK_MODE unset)', async () => {
    process.env.CODEX_FAKE_OUTPUT = 'totally not json';
    await expect(
      callLLMJson('Analyze ...', { task: 'analysis', schema: ANALYSIS_SCHEMA }),
    ).rejects.toThrow();
  });
});
