/**
 * Run command implementation.
 */

import { Command } from 'commander';
import { TaskRunner } from '../../core/runner.js';
import { createAgent } from '../../agents/factory.js';
import type { RunnerConfig } from '../../core/config.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

function collectModels(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeModels(rawModels: string[]): string[] {
  if (rawModels.length === 0) {
    return [DEFAULT_MODEL];
  }

  const models = rawModels
    .flatMap(model => model.split(','))
    .map(model => model.trim())
    .filter(model => model.length > 0);

  return models.length > 0 ? [...new Set(models)] : [DEFAULT_MODEL];
}

export function createRunCommand(config: RunnerConfig): Command {
  const command = new Command('run')
    .description('Run benchmark tasks')
    .option('-t, --task <task-id>', 'Run a specific task by ID')
    .option('-s, --suite <suite>', 'Run a task suite (all, category name)')
    .option(
      '-m, --model <model>',
      'Model to use (format: provider/model). Repeat or use comma-separated values for multi-model task runs',
      collectModels,
      [] as string[]
    )
    .option('--no-verify', 'Skip verification step')
    .option('--judge-model <model>', 'LLM model used as judge for verification')
    .option('--filter <filter>', 'Filter tasks (e.g., difficulty=easy)')
    .action(async (options) => {
      try {
        const runnerConfig = options.judgeModel
          ? { ...config, judgeModel: options.judgeModel }
          : config;
        const runner = new TaskRunner(runnerConfig);
        const skipVerify = !options.verify;
        const models = normalizeModels(options.model);

        if (options.task) {
          // Run single task
          logger.info(`Running task: ${options.task}`);
          logger.info(`Using model(s): ${models.join(', ')}`);
          logger.info(`Skip verification: ${skipVerify}\n`);

          if (models.length === 1) {
            const agent = createAgent(models[0]);
            const result = await runner.runTask(options.task, agent, skipVerify, models[0]);

            logger.taskResult(
              result.success,
              result.score,
              result.iterations,
              result.duration_secs,
              result.tokens_used || undefined
            );

            process.exit(result.success ? 0 : 1);
          }

          logger.info(`Running ${models.length} models in parallel for task ${options.task}\n`);

          const modelRuns = models.map(model => ({
            model,
            agent: createAgent(model),
          }));

          const results = await runner.runTaskParallel(
            options.task,
            modelRuns.map(run => ({ agent: run.agent, runId: run.model })),
            skipVerify
          );

          let allPassed = true;
          for (const [index, result] of results.entries()) {
            const model = modelRuns[index]?.model ?? 'unknown';
            logger.info(`Model result: ${model}`);
            logger.taskResult(
              result.success,
              result.score,
              result.iterations,
              result.duration_secs,
              result.tokens_used || undefined
            );
            if (!result.success) {
              allPassed = false;
            }
          }

          process.exit(allPassed ? 0 : 1);
        } else if (options.suite) {
          // Run suite
          if (options.suite === 'all') {
            logger.info('Running all tasks');
            logger.info(`Using model(s): ${models.join(', ')}`);
            logger.info(`Skip verification: ${skipVerify}\n`);

            for (const model of models) {
              logger.info(`Starting suite run for model: ${model}`);
              const agent = createAgent(model);
              await runner.runAll(agent, skipVerify, model);
            }
          } else {
            // Run category suite
            logger.info(`Running category: ${options.suite}`);
            logger.info(`Using model(s): ${models.join(', ')}`);
            logger.info(`Skip verification: ${skipVerify}\n`);

            for (const model of models) {
              logger.info(`Starting category run for model: ${model}`);
              const agent = createAgent(model);
              await runner.runCategory(options.suite, agent, skipVerify, model);
            }
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
