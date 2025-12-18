/**
 * Collect and consolidate benchmark results into CSV format.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';
import type { BenchmarkResult } from '../evaluator/results.js';
import { logger } from '../utils/logger.js';

/**
 * Load a single result JSON file.
 */
async function loadResult(filePath: string): Promise<BenchmarkResult> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Collect all JSON result files from the results directory.
 */
export async function collectResults(resultsDir: string): Promise<BenchmarkResult[]> {
  const files = await readdir(resultsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('suite_'));

  const results: BenchmarkResult[] = [];

  for (const file of jsonFiles) {
    try {
      const result = await loadResult(join(resultsDir, file));
      results.append(result);
    } catch (error) {
      logger.warn(`Failed to load ${file}: ${error}`);
    }
  }

  return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Write results to a CSV file.
 */
export async function writeCSV(results: BenchmarkResult[], outputPath: string): Promise<void> {
  if (results.length === 0) {
    logger.warn('No results to write');
    return;
  }

  // Define CSV columns
  const columns = [
    'task_id',
    'agent',
    'agent_version',
    'model_name',
    'timestamp',
    'success',
    'score',
    'iterations',
    'duration_secs',
    'tokens_used',
    'error',
  ];

  // Convert results to CSV rows
  const rows = results.map(result => ({
    task_id: result.task_id,
    agent: result.agent,
    agent_version: result.agent_version || '',
    model_name: result.model_name || '',
    timestamp: result.timestamp,
    success: result.success,
    score: result.score,
    iterations: result.iterations,
    duration_secs: result.duration_secs.toFixed(2),
    tokens_used: result.tokens_used || '',
    error: result.error ? result.error.substring(0, 100) : '', // Truncate long errors
  }));

  // Generate CSV
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  // Write to file
  await writeFile(outputPath, csv, 'utf-8');

  logger.success(`Wrote ${results.length} results to ${outputPath}`);
}

/**
 * Collect and write results in one operation.
 */
export async function collectAndWrite(resultsDir: string, outputPath: string): Promise<void> {
  logger.info(`Collecting results from ${resultsDir}...`);
  const results = await collectResults(resultsDir);
  logger.info(`Found ${results.length} result files`);

  await writeCSV(results, outputPath);
}
