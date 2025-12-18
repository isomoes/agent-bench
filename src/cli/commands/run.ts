/**
 * Run command implementation.
 */

import { Command } from 'commander';
import { TaskRunner } from '../../core/runner.js';
import { createAgent } from '../../agents/factory.js';
import type { RunnerConfig } from '../../core/config.js';
import { logger } from '../../utils/logger.js';

export function createRunCommand(config: RunnerConfig): Command {
  const command = new Command('run')
    .description('Run benchmark tasks')
    .option('-t, --task <task-id>', 'Run a specific task by ID')
    .option('-s, --suite <suite>', 'Run a task suite (all, category name)')
    .option('-m, --model <model>', 'Model to use (format: provider/model)', 'anthropic/claude-sonnet-4-5')
    .option('--no-verify', 'Skip verification step')
    .option('--filter <filter>', 'Filter tasks (e.g., difficulty=easy)')
    .action(async (options) => {
      try {
        const agent = createAgent(options.model);
        const runner = new TaskRunner(config);
        const skipVerify = !options.verify;

        if (options.task) {
          // Run single task
          logger.info(`Running task: ${options.task}`);
          logger.info(`Using model: ${options.model}`);
          logger.info(`Skip verification: ${skipVerify}\n`);

          const result = await runner.runTask(options.task, agent, skipVerify);

          logger.taskResult(
            result.success,
            result.score,
            result.iterations,
            result.duration_secs,
            result.tokens_used || undefined
          );

          process.exit(result.success ? 0 : 1);
        } else if (options.suite) {
          // Run suite
          if (options.suite === 'all') {
            logger.info('Running all tasks');
            logger.info(`Using model: ${options.model}`);
            logger.info(`Skip verification: ${skipVerify}\n`);

            await runner.runAll(agent, skipVerify);
          } else {
            // Run category suite
            logger.info(`Running category: ${options.suite}`);
            logger.info(`Using model: ${options.model}`);
            logger.info(`Skip verification: ${skipVerify}\n`);

            await runner.runCategory(options.suite, agent, skipVerify);
          }
        } else {
          logger.error('Please specify either --task or --suite');
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Run failed: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
