/**
 * Collect command implementation.
 */

import { Command } from 'commander';
import { join } from 'path';
import { collectAndWrite } from '../../collectors/csv.js';
import { logger } from '../../utils/logger.js';

export function createCollectCommand(resultsDir: string): Command {
  const command = new Command('collect')
    .description('Collect benchmark results into CSV format')
    .option('-o, --output <path>', 'Output CSV path', join(resultsDir, 'summary.csv'))
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
