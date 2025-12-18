/**
 * List command implementation.
 */

import { Command } from 'commander';
import { TaskLoader } from '../../core/loader.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export function createListCommand(tasksDir: string): Command {
  const command = new Command('list')
    .description('List all available benchmark tasks')
    .option('-c, --category <category>', 'Filter by category')
    .option('-d, --difficulty <difficulty>', 'Filter by difficulty')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('-v, --verbose', 'Show detailed task information')
    .action(async (options) => {
      const loader = new TaskLoader(tasksDir);

      try {
        let tasks = await loader.loadAll();

        // Apply filters
        if (options.category) {
          tasks = tasks.filter(t => t.category === options.category);
        }
        if (options.difficulty) {
          tasks = tasks.filter(t => t.difficulty === options.difficulty);
        }
        if (options.tags) {
          const filterTags = options.tags.split(',').map((t: string) => t.trim());
          tasks = tasks.filter(task => {
            const taskTags = task.metadata?.tags || [];
            return filterTags.some(tag => taskTags.includes(tag));
          });
        }

        if (tasks.length === 0) {
          logger.warn('No tasks found matching the criteria');
          return;
        }

        logger.info(`Found ${tasks.length} tasks\n`);

        if (options.verbose) {
          // Verbose mode: show full details
          for (const task of tasks) {
            console.log(chalk.bold.cyan(`━━━ ${task.id} ━━━`));
            console.log(chalk.bold(`  Title: ${task.title}`));
            console.log(`  Category: ${task.category}`);
            console.log(`  Difficulty: ${task.difficulty}`);
            console.log(`  Repository: ${task.source.repository}`);
            console.log(`  Commit: ${task.source.commit}`);
            if (task.metadata?.tags && task.metadata.tags.length > 0) {
              console.log(`  Tags: ${task.metadata.tags.join(', ')}`);
            }
            if (task.max_iterations) {
              console.log(`  Max Iterations: ${task.max_iterations}`);
            }
            console.log();
          }
        } else {
          // Compact mode: table format
          console.log(chalk.bold('ID'.padEnd(20)) + chalk.bold('Title'.padEnd(40)) + chalk.bold('Category'.padEnd(15)) + chalk.bold('Difficulty'));
          console.log('─'.repeat(85));

          for (const task of tasks) {
            const id = task.id.padEnd(20);
            const title = task.title.substring(0, 37).padEnd(40);
            const category = task.category.padEnd(15);
            const difficulty = task.difficulty;

            console.log(`${id}${title}${category}${difficulty}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to list tasks: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
