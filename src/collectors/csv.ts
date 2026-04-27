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
      results.push(result);
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
    'agent_version',
    'model_name',
    'timestamp',
    'pass',
    'judge_score',
    'judge_model',
    'iterations',
    'duration_secs',
    'tokens_used',
  ];

  // Convert results to CSV rows
  const rows = results.map(result => ({
    task_id: result.task_id,
    agent_version: result.agent_version || '',
    model_name: result.model_name || '',
    timestamp: result.timestamp,
    pass: result.success,
    judge_score: result.judge_score ?? '',
    judge_model: result.judge_model || '',
    iterations: result.iterations,
    duration_secs: result.duration_secs.toFixed(2),
    tokens_used: result.tokens_used ?? '',
  }));

  // Generate CSV
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  // Write to file
  await writeFile(outputPath, csv, 'utf-8');

  logger.success(`Wrote ${rows.length} results to ${outputPath}`);
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

/**
 * Append a single result to the CSV file.
 * Creates the file with header if it doesn't exist.
 */
export async function appendResultToCSV(result: BenchmarkResult, outputPath: string): Promise<void> {
  try {
    // Check if file exists
    let existingContent = '';
    try {
      existingContent = await readFile(outputPath, 'utf-8');
    } catch {
      // File doesn't exist, will create with header
    }

    // Define CSV columns
    const columns = [
      'task_id',
      'agent_version',
      'model_name',
      'timestamp',
      'pass',
      'judge_score',
      'judge_model',
      'iterations',
      'duration_secs',
      'tokens_used',
    ];

    // Convert result to CSV row
    const row = {
      task_id: result.task_id,
      agent_version: result.agent_version || '',
      model_name: result.model_name || '',
      timestamp: result.timestamp,
      pass: result.success,
      judge_score: result.judge_score ?? '',
      judge_model: result.judge_model || '',
      iterations: result.iterations,
      duration_secs: result.duration_secs.toFixed(2),
      tokens_used: result.tokens_used ?? '',
    };

    // Check for duplicates
    if (existingContent) {
      const lines = existingContent.trim().split('\n');
      // Skip header line, check data rows
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const [existingTaskId, , , existingTimestamp] = line.split(',');
        if (existingTaskId === result.task_id && 
            existingTimestamp === result.timestamp) {
          // Duplicate found, skip
          logger.debug(`Result already exists in CSV, skipping: ${result.task_id}`);
          return;
        }
      }
    }

    // Generate CSV for the new row
    const { stringify } = await import('csv-stringify/sync');
    const needsHeader = !existingContent;
    const csv = stringify([row], {
      header: needsHeader,
      columns,
    });

    // Append to file
    const { appendFile, writeFile } = await import('fs/promises');
    if (needsHeader) {
      await writeFile(outputPath, csv, 'utf-8');
    } else {
      // csv already has a trailing newline, just append it directly
      await appendFile(outputPath, csv, 'utf-8');
    }

    logger.debug(`Appended result to CSV: ${result.task_id}`);
  } catch (error) {
    logger.warn(`Failed to append to CSV: ${error}`);
    // Don't throw - CSV append is best-effort
  }
}

