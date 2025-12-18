/**
 * Verification for task execution.
 */

import { spawn } from 'child_process';
import { Task } from '../core/task.js';
import { VerificationError } from '../utils/errors.js';

/**
 * Verification result.
 */
export interface VerificationResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSecs: number;
}

/**
 * Verifier for running task verification commands.
 */
export class Verifier {
  /**
   * Run verification for a task in the given workspace.
   * @param task The task to verify
   * @param workspace The workspace path
   * @returns Verification result
   */
  static async verify(task: Task, workspace: string): Promise<VerificationResult> {
    const startTime = Date.now();

    // Parse the command
    const commandParts = task.verification.command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (commandParts.length === 0) {
      throw new VerificationError('Empty verification command');
    }

    const program = commandParts[0].replace(/"/g, '');
    const args = commandParts.slice(1).map(arg => arg.replace(/"/g, ''));

    // Execute command with timeout
    return new Promise((resolve, reject) => {
      const proc = spawn(program, args, {
        cwd: workspace,
        timeout: task.verification.timeout * 1000, // Convert to milliseconds
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const durationSecs = (Date.now() - startTime) / 1000;
        resolve({
          passed: code === 0,
          exitCode: code,
          stdout,
          stderr,
          durationSecs,
        });
      });

      proc.on('error', (error) => {
        const durationSecs = (Date.now() - startTime) / 1000;

        // Check if it's a timeout error
        if ((error as any).code === 'ETIMEDOUT') {
          reject(
            new VerificationError(
              `Verification command timed out after ${task.verification.timeout} seconds`
            )
          );
        } else {
          reject(new VerificationError(`Failed to execute verification command: ${error.message}`));
        }
      });

      // Additional timeout handling
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        const durationSecs = (Date.now() - startTime) / 1000;
        reject(
          new VerificationError(
            `Verification command timed out after ${task.verification.timeout} seconds`
          )
        );
      }, task.verification.timeout * 1000);

      proc.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }
}
