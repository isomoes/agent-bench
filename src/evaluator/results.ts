/**
 * Benchmark results and result persistence.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * V1 composite score for a benchmark run.
 *
 * - Failed runs (pass === false) always score 0.
 * - Passed runs are scored on speed × cost (geometric mean, 0–100):
 *     speed_factor = 1 / (1 + duration_secs / 60)     half-life 60 s
 *     cost_factor  = 1 / (1 + tokens_used  / 20_000)  half-life 20 k tokens
 *     score        = 100 × √(speed_factor × cost_factor)
 */
export function calcScore(
  passed: boolean,
  durationSecs: number,
  tokensUsed: number | null,
): number {
  if (!passed) return 0;
  const speed = 1 / (1 + durationSecs / 60);
  const cost  = 1 / (1 + (tokensUsed ?? 0) / 20_000);
  return Math.round(100 * Math.sqrt(speed * cost) * 10) / 10;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

/**
 * Benchmark result for a single task run.
 */
export interface BenchmarkResult {
  task_id: string;
  agent: string;
  success: boolean;
  score: number;
  /** The LLM that acted as judge and assigned the score. null when scoring
   *  is purely deterministic (verify.py exit code only). */
  judge_model: string | null;
  iterations: number;
  tokens_used: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_secs: number;
  verification_output: string | null;
  agent_output: string | null;
  timestamp: string;
  error: string | null;
  agent_version: string | null;
  model_name: string | null;
}

/**
 * Create a successful benchmark result.
 */
export function createSuccess(
  taskId: string,
  agent: string,
  iterations: number,
  tokensUsed: number | null,
  durationSecs: number,
  agentVersion: string | null = null,
  modelName: string | null = null,
  inputTokens: number | null = null,
  outputTokens: number | null = null,
  judgeModel: string | null = null,
): BenchmarkResult {
  return {
    task_id: taskId,
    agent,
    success: true,
    score: calcScore(true, durationSecs, tokensUsed),
    judge_model: judgeModel,
    iterations,
    tokens_used: tokensUsed,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_secs: durationSecs,
    verification_output: null,
    agent_output: null,
    timestamp: new Date().toISOString(),
    error: null,
    agent_version: agentVersion,
    model_name: modelName,
  };
}

/**
 * Create a failed benchmark result.
 */
export function createFailure(
  taskId: string,
  agent: string,
  iterations: number,
  tokensUsed: number | null,
  durationSecs: number,
  error: string,
  agentVersion: string | null = null,
  modelName: string | null = null,
  inputTokens: number | null = null,
  outputTokens: number | null = null,
  judgeModel: string | null = null,
): BenchmarkResult {
  return {
    task_id: taskId,
    agent,
    success: false,
    score: 0,
    judge_model: judgeModel,
    iterations,
    tokens_used: tokensUsed,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_secs: durationSecs,
    verification_output: null,
    agent_output: null,
    timestamp: new Date().toISOString(),
    error,
    agent_version: agentVersion,
    model_name: modelName,
  };
}

/**
 * Override the score on a result (used when an LLM judge provides a direct 0-100 score).
 * Also sets success=true when score > 0.
 */
export function withJudgeScore(result: BenchmarkResult, score: number): BenchmarkResult {
  const clamped = Math.max(0, Math.min(100, score));
  return {
    ...result,
    score: clamped,
    success: clamped > 0,
  };
}

/**
 * Add verification output to a result.
 */
export function withVerificationOutput(result: BenchmarkResult, output: string): BenchmarkResult {
  return {
    ...result,
    verification_output: output,
  };
}

/**
 * Add agent output to a result.
 */
export function withAgentOutput(result: BenchmarkResult, output: string): BenchmarkResult {
  return {
    ...result,
    agent_output: output,
  };
}

/**
 * Save a benchmark result to a JSON file.
 * @returns The path to the saved file
 */
export async function saveResult(result: BenchmarkResult, resultsDir: string): Promise<string> {
  const runsDir = join(resultsDir, 'runs');
  await mkdir(runsDir, { recursive: true });

  const timestamp = formatTimestamp(result.timestamp);
  const status = result.success ? 'pass' : 'fail';
  const model = sanitizeForFilename(result.model_name ?? 'unknown-model');
  const filename = `${result.task_id}_${result.agent}_${model}_${timestamp}_${status}.json`;
  const path = join(runsDir, filename);

  await writeFile(path, JSON.stringify(result, null, 2), 'utf-8');

  // Auto-append to V1 summary JSON
  try {
    const { appendResultToJSON } = await import('../collectors/json.js');
    const jsonPath = join(resultsDir, 'result-v1.json');
    await appendResultToJSON(result, jsonPath);
  } catch (error) {
    // Log but don't fail the save operation
    console.warn(`[WARN] Failed to auto-append to summary: ${error}`);
  }

  return path;
}

/**
 * Suite results for multiple tasks.
 */
export interface SuiteResults {
  agent: string;
  timestamp: string;
  results: BenchmarkResult[];
  total_tasks: number;
  passed: number;
  failed: number;
  pass_rate: number;
  total_duration_secs: number;
}

/**
 * Create suite results from individual benchmark results.
 */
export function createSuiteResults(agent: string, results: BenchmarkResult[]): SuiteResults {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration_secs, 0);

  return {
    agent,
    timestamp: new Date().toISOString(),
    results,
    total_tasks: results.length,
    passed,
    failed,
    pass_rate: results.length > 0 ? passed / results.length : 0,
    total_duration_secs: totalDuration,
  };
}

/**
 * Save suite results to a JSON file.
 * @returns The path to the saved file
 */
export async function saveSuiteResults(suite: SuiteResults, resultsDir: string): Promise<string> {
  await mkdir(resultsDir, { recursive: true });
  const runsDir = join(resultsDir, 'runs');
  await mkdir(runsDir, { recursive: true });

  const timestamp = formatTimestamp(suite.timestamp);
  const agent = sanitizeForFilename(suite.agent);
  const filename = `suite_${agent}_${timestamp}.json`;
  const runsPath = join(runsDir, filename);
  const payload = JSON.stringify(suite, null, 2);

  await writeFile(runsPath, payload, 'utf-8');

  return runsPath;
}
