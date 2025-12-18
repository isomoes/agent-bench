/**
 * CLI setup with Commander.js
 */

import { Command } from 'commander';
import { createDefaultConfig, loadUserConfig, mergeConfig } from '../core/config.js';
import { logger } from '../utils/logger.js';
import { createListCommand } from './commands/list.js';
import { createRunCommand } from './commands/run.js';
import { createCollectCommand } from './commands/collect.js';
import { createVerifyCommand } from './commands/verify.js';
import { createInitCommand } from './commands/init.js';

/**
 * Create and configure the CLI program.
 */
export async function createCLI(): Promise<Command> {
  // Load configuration
  const defaultConfig = createDefaultConfig();
  const userConfig = await loadUserConfig();
  const config = mergeConfig(userConfig, defaultConfig);

  // Create program
  const program = new Command();

  program
    .name('agent-bench')
    .description('An open-source benchmark for evaluating AI coding agents')
    .version('0.2.0')
    .option('--debug', 'Enable debug logging')
    .option('--tasks-dir <path>', 'Tasks directory', config.tasksDir)
    .option('--results-dir <path>', 'Results directory', config.resultsDir)
    .option('--workspace-dir <path>', 'Workspace directory', config.workspaceDir)
    .hook('preAction', (thisCommand) => {
      // Enable debug logging if requested
      const opts = thisCommand.opts();
      if (opts.debug) {
        logger.setDebug(true);
      }

      // Update config with CLI options
      if (opts.tasksDir) config.tasksDir = opts.tasksDir;
      if (opts.resultsDir) config.resultsDir = opts.resultsDir;
      if (opts.workspaceDir) config.workspaceDir = opts.workspaceDir;
    });

  // Register commands
  program.addCommand(createListCommand(config.tasksDir));
  program.addCommand(createRunCommand(config));
  program.addCommand(createCollectCommand(config.resultsDir));
  program.addCommand(createVerifyCommand(config.tasksDir));
  program.addCommand(createInitCommand());

  return program;
}
