/**
 * Init command implementation.
 */

import { Command } from 'commander';
import { saveUserConfig, getConfigPath } from '../../core/config.js';
import { logger } from '../../utils/logger.js';

export function createInitCommand(): Command {
  const command = new Command('init')
    .description('Initialize agent-bench configuration')
    .option('--opencode-url <url>', 'OpenCode server URL')
    .option('--default-model <model>', 'Default model (provider/model)')
    .option('--tasks-dir <path>', 'Tasks directory path')
    .option('--results-dir <path>', 'Results directory path')
    .option('--workspace-dir <path>', 'Workspace directory path')
    .action(async (options) => {
      try {
        const config: any = {};

        if (options.opencodeUrl) config.opencodeUrl = options.opencodeUrl;
        if (options.defaultModel) config.defaultModel = options.defaultModel;
        if (options.tasksDir) config.tasksDir = options.tasksDir;
        if (options.resultsDir) config.resultsDir = options.resultsDir;
        if (options.workspaceDir) config.workspaceDir = options.workspaceDir;

        await saveUserConfig(config);

        const configPath = getConfigPath();
        logger.success(`Configuration saved to: ${configPath}`);

        console.log('\nConfiguration:');
        for (const [key, value] of Object.entries(config)) {
          console.log(`  ${key}: ${value}`);
        }
      } catch (error) {
        logger.error(`Init failed: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
