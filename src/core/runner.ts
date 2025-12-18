/**
 * Task runner for executing benchmarks.
 */

import { TaskLoader } from './loader.js';
import { WorkspaceManager } from './workspace.js';
import { Task } from './task.js';
import type { Agent } from '../agents/types.js';
import { Verifier } from '../evaluator/verifier.js';
import type { BenchmarkResult } from '../evaluator/results.js';
import {
  createSuccess,
  createFailure,
  withAgentOutput,
  withVerificationOutput,
  saveResult,
  createSuiteResults,
  saveSuiteResults,
} from '../evaluator/results.js';
import type { RunnerConfig } from './config.js';
import { logger } from '../utils/logger.js';
import { AgentError } from '../utils/errors.js';

/**
 * Task runner for executing benchmarks.
 */
export class TaskRunner {
  private config: RunnerConfig;
  private loader: TaskLoader;
  private workspace: WorkspaceManager;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.loader = new TaskLoader(config.tasksDir);
    this.workspace = new WorkspaceManager(config.workspaceDir);
  }

  /**
   * Run a single task with the specified agent.
   */
  async runTask(taskId: string, agent: Agent, skipVerify: boolean = false): Promise<BenchmarkResult> {
    const task = await this.loader.loadById(taskId);
    return await this.executeTask(task, agent, skipVerify);
  }

  /**
   * Run all tasks.
   */
  async runAll(agent: Agent, skipVerify: boolean = false): Promise<void> {
    const tasks = await this.loader.loadAll();

    logger.info(`Running ${tasks.length} tasks with agent: ${agent.name()}`);

    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      logger.taskHeader(task.id, task.title);

      const result = await this.executeTask(task, agent, skipVerify);
      results.push(result);

      logger.taskResult(
        result.success,
        result.score,
        result.iterations,
        result.duration_secs,
        result.tokens_used || undefined
      );
    }

    // Save suite results
    const suite = createSuiteResults(agent.name(), results);
    const suitePath = await saveSuiteResults(suite, this.config.resultsDir);

    logger.suiteSummary(
      suite.total_tasks,
      suite.passed,
      suite.failed,
      suite.pass_rate,
      suite.total_duration_secs
    );

    logger.success(`Suite results saved to: ${suitePath}`);
  }

  /**
   * Run tasks by category.
   */
  async runCategory(category: string, agent: Agent, skipVerify: boolean = false): Promise<void> {
    const tasks = await this.loader.filterByCategory(category);

    if (tasks.length === 0) {
      logger.warn(`No tasks found for category: ${category}`);
      return;
    }

    logger.info(`Running ${tasks.length} tasks in category "${category}"`);

    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      logger.taskHeader(task.id, task.title);

      const result = await this.executeTask(task, agent, skipVerify);
      results.push(result);

      logger.taskResult(
        result.success,
        result.score,
        result.iterations,
        result.duration_secs,
        result.tokens_used || undefined
      );
    }

    // Save suite results
    const suite = createSuiteResults(agent.name(), results);
    const suitePath = await saveSuiteResults(suite, this.config.resultsDir);

    logger.suiteSummary(
      suite.total_tasks,
      suite.passed,
      suite.failed,
      suite.pass_rate,
      suite.total_duration_secs
    );

    logger.success(`Suite results saved to: ${suitePath}`);
  }

  /**
   * Execute a single task.
   */
  private async executeTask(task: Task, agent: Agent, skipVerify: boolean): Promise<BenchmarkResult> {
    const startTime = Date.now();

    // Prepare workspace
    logger.info('Preparing workspace...');
    let workspacePath: string;
    try {
      workspacePath = await this.workspace.prepare(task);
      logger.success(`Workspace ready: ${workspacePath}`);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const result = createFailure(
        task.id,
        agent.name(),
        0,
        null,
        duration,
        `Failed to prepare workspace: ${error}`,
        null,
        null
      );
      await saveResult(result, this.config.resultsDir);
      return result;
    }

    // Execute agent
    logger.info('Executing agent...');
    let agentResult;
    try {
      agentResult = await agent.execute(task, workspacePath);
      logger.success(`Agent execution completed: ${agentResult.iterations} iterations`);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const result = createFailure(
        task.id,
        agent.name(),
        0,
        null,
        duration,
        `Agent execution failed: ${error}`,
        null,
        null
      );
      await saveResult(result, this.config.resultsDir);
      return result;
    }

    // Run verification (unless skipped)
    let result: BenchmarkResult;
    if (skipVerify) {
      logger.warn('Skipping verification');
      result = createSuccess(
        task.id,
        agent.name(),
        agentResult.iterations,
        agentResult.tokensUsed,
        agentResult.durationSecs,
        agentResult.agentVersion,
        agentResult.modelName
      );
    } else {
      logger.info('Running verification...');
      try {
        const verification = await Verifier.verify(task, workspacePath);

        if (verification.passed) {
          logger.success('Verification passed');
          result = createSuccess(
            task.id,
            agent.name(),
            agentResult.iterations,
            agentResult.tokensUsed,
            agentResult.durationSecs,
            agentResult.agentVersion,
            agentResult.modelName
          );
        } else {
          logger.error(`Verification failed with exit code: ${verification.exitCode}`);
          result = createFailure(
            task.id,
            agent.name(),
            agentResult.iterations,
            agentResult.tokensUsed,
            agentResult.durationSecs,
            'Verification tests failed',
            agentResult.agentVersion,
            agentResult.modelName
          );
        }

        // Add verification output
        result = withVerificationOutput(
          result,
          `Exit code: ${verification.exitCode}\n\nSTDOUT:\n${verification.stdout}\n\nSTDERR:\n${verification.stderr}`
        );
      } catch (error) {
        logger.error(`Verification error: ${error}`);
        result = createFailure(
          task.id,
          agent.name(),
          agentResult.iterations,
          agentResult.tokensUsed,
          agentResult.durationSecs,
          `Verification error: ${error}`,
          agentResult.agentVersion,
          agentResult.modelName
        );
      }
    }

    // Add agent output
    result = withAgentOutput(result, agentResult.output);

    // Save result
    const resultPath = await saveResult(result, this.config.resultsDir);
    logger.debug(`Result saved to: ${resultPath}`);

    return result;
  }

  /**
   * List all available tasks.
   */
  async listTasks(): Promise<Task[]> {
    return await this.loader.loadAll();
  }
}
