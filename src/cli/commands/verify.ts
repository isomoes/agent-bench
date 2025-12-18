/**
 * Verify command implementation.
 */

import { Command } from 'commander';
import { TaskLoader } from '../../core/loader.js';
import { Verifier } from '../../evaluator/verifier.js';
import { logger } from '../../utils/logger.js';

export function createVerifyCommand(tasksDir: string): Command {
  const command = new Command('verify')
    .description('Manually verify a task in a workspace')
    .requiredOption('-t, --task <task-id>', 'Task ID to verify')
    .requiredOption('-w, --workspace <path>', 'Workspace path')
    .action(async (options) => {
      try {
        const loader = new TaskLoader(tasksDir);
        const task = await loader.loadById(options.task);

        logger.info(`Verifying task: ${task.id}`);
        logger.info(`Workspace: ${options.workspace}\n`);

        const result = await Verifier.verify(task, options.workspace);

        logger.taskResult(
          result.passed,
          result.passed ? 100 : 0,
          0,
          result.durationSecs,
          undefined
        );

        console.log(`\nExit code: ${result.exitCode}`);
        console.log(`\nSTDOUT:\n${result.stdout}`);
        console.log(`\nSTDERR:\n${result.stderr}`);

        process.exit(result.passed ? 0 : 1);
      } catch (error) {
        logger.error(`Verification failed: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
