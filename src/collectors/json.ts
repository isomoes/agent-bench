/**
 * Collect and consolidate benchmark results into JSON format.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { BenchmarkResult } from '../evaluator/results.js';
import { logger } from '../utils/logger.js';

/**
 * V1 summary entry — includes pass/fail, composite score, and judge model.
 */
export interface SummaryEntry {
  task_id: string;
  agent_version: string;
  model_name: string;
  timestamp: string;
  pass: boolean;
  score: number;
  /** LLM that acted as judge. null = deterministic verify.py only. */
  judge_model: string | null;
  iterations: number;
  duration_secs: number;
  tokens_used: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

function toEntry(result: BenchmarkResult): SummaryEntry {
  return {
    task_id: result.task_id,
    agent_version: result.agent_version || '',
    model_name: result.model_name || '',
    timestamp: result.timestamp,
    pass: result.success,
    score: result.score,
    judge_model: result.judge_model ?? null,
    iterations: result.iterations,
    duration_secs: parseFloat(result.duration_secs.toFixed(2)),
    tokens_used: result.tokens_used,
    input_tokens: result.input_tokens ?? null,
    output_tokens: result.output_tokens ?? null,
  };
}

/**
 * Load a single result JSON file.
 */
async function loadResult(filePath: string): Promise<BenchmarkResult> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Collect all JSON result files from the runs/ subdirectory.
 */
export async function collectResults(resultsDir: string): Promise<BenchmarkResult[]> {
  const runsDir = join(resultsDir, 'runs');
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    logger.warn(`Runs directory not found: ${runsDir}`);
    return [];
  }
  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('suite_'));

  const results: BenchmarkResult[] = [];

  for (const file of jsonFiles) {
    try {
      const result = await loadResult(join(runsDir, file));
      results.push(result);
    } catch (error) {
      logger.warn(`Failed to load ${file}: ${error}`);
    }
  }

  return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Write all results (pass and fail) to a V1 JSON summary file.
 */
export async function writeJSON(results: BenchmarkResult[], outputPath: string): Promise<void> {
  if (results.length === 0) {
    logger.warn('No results to write');
    return;
  }

  const entries = results.map(toEntry);
  await writeFile(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
  logger.success(`Wrote ${entries.length} results to ${outputPath}`);
}

/**
 * Collect and write results in one operation.
 */
export async function collectAndWrite(resultsDir: string, outputPath: string): Promise<void> {
  logger.info(`Collecting results from ${resultsDir}...`);
  const results = await collectResults(resultsDir);
  logger.info(`Found ${results.length} result files`);
  await writeJSON(results, outputPath);
}

/**
 * Append a result (pass or fail) to the V1 JSON summary file.
 * Creates the file if it doesn't exist.
 */
export async function appendResultToJSON(result: BenchmarkResult, outputPath: string): Promise<void> {
  try {
    // Load existing entries
    let entries: SummaryEntry[] = [];
    try {
      const content = await readFile(outputPath, 'utf-8');
      entries = JSON.parse(content);
    } catch {
      // File doesn't exist yet
    }

    // Check for duplicates
    const isDuplicate = entries.some(
      e => e.task_id === result.task_id &&
           e.timestamp === result.timestamp
    );
    if (isDuplicate) {
      logger.debug(`Result already exists in summary, skipping: ${result.task_id}`);
      return;
    }

    entries.push(toEntry(result));
    await writeFile(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
    logger.debug(`Appended result to summary: ${result.task_id}`);
  } catch (error) {
    logger.warn(`Failed to append to summary: ${error}`);
  }
}
