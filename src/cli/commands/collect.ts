/**
 * Collect command implementation.
 */

import { Command } from 'commander';
import { join } from 'path';
import { collectAndWrite } from '../../collectors/json.js';
import { logger } from '../../utils/logger.js';

export function createCollectCommand(resultsDir: string): Command {
  const command = new Command('collect')
    .description('Collect benchmark results into V1 JSON summary')
    .option('-o, --output <path>', 'Output JSON path', join(resultsDir, 'result-v1.json'))
    .action(async (options) => {
      try {
        await collectAndWrite(resultsDir, options.output);
        logger.success(`\nResults summary available at: ${options.output}`);
      } catch (error) {
        logger.error(`Collection failed: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
