/**
 * Colored logging utilities.
 */

import chalk from 'chalk';

/**
 * Log levels.
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

/**
 * Logger class for colored console output.
 */
export class Logger {
  private debugEnabled: boolean;

  constructor(debugEnabled: boolean = false) {
    this.debugEnabled = debugEnabled;
  }

  /**
   * Enable or disable debug logging.
   */
  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Log debug message (only if debug enabled).
   */
  debug(message: string, ...args: any[]): void {
    if (this.debugEnabled) {
      console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  /**
   * Log info message.
   */
  info(message: string, ...args: any[]): void {
    console.log(chalk.blue(`[INFO] ${message}`), ...args);
  }

  /**
   * Log success message.
   */
  success(message: string, ...args: any[]): void {
    console.log(chalk.green(`✓ ${message}`), ...args);
  }

  /**
   * Log warning message.
   */
  warn(message: string, ...args: any[]): void {
    console.warn(chalk.yellow(`[WARN] ${message}`), ...args);
  }

  /**
   * Log error message.
   */
  error(message: string, ...args: any[]): void {
    console.error(chalk.red(`[ERROR] ${message}`), ...args);
  }

  /**
   * Log task header.
   */
  taskHeader(taskId: string, title: string): void {
    console.log(chalk.bold.cyan(`\n┌─ Task: ${taskId}`));
    console.log(chalk.cyan(`└─ ${title}\n`));
  }

  /**
   * Log task result.
   */
  taskResult(passed: boolean, score: number, iterations: number, duration: number, tokens?: number): void {
    const status = passed ? chalk.green.bold('PASS') : chalk.red.bold('FAIL');
    console.log(`\n${status}`);
    console.log(`  Score: ${score}/100`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Duration: ${duration.toFixed(2)}s`);
    if (tokens !== undefined && tokens !== null) {
      console.log(`  Tokens: ${tokens}`);
    }
  }

  /**
   * Log suite summary.
   */
  suiteSummary(totalTasks: number, passed: number, failed: number, passRate: number, duration: number): void {
    console.log(chalk.bold('\n═══════════════════════════════════════'));
    console.log(chalk.bold('  Suite Summary'));
    console.log(chalk.bold('═══════════════════════════════════════'));
    console.log(`  Total Tasks: ${totalTasks}`);
    console.log(`  ${chalk.green('Passed')}: ${passed}`);
    console.log(`  ${chalk.red('Failed')}: ${failed}`);
    console.log(`  Pass Rate: ${(passRate * 100).toFixed(1)}%`);
    console.log(`  Total Duration: ${duration.toFixed(2)}s`);
    console.log(chalk.bold('═══════════════════════════════════════\n'));
  }
}

/**
 * Global logger instance.
 */
export const logger = new Logger();
