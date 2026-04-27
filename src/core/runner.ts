/**
 * Task runner for executing benchmarks.
 */

import { TaskLoader } from './loader.js';
import { WorkspaceManager } from './workspace.js';
import { Task } from './task.js';
import type { Agent } from '../agents/types.js';
import { callJudge } from '../evaluator/verifier.js';
import type { BenchmarkResult } from '../evaluator/results.js';
import {
  createSuccess,
  createFailure,
  withAgentOutput,
  withVerificationOutput,
  withJudgeScore,
  saveResult,
  createSuiteResults,
  saveSuiteResults,
} from '../evaluator/results.js';
import type { RunnerConfig } from './config.js';
import { logger } from '../utils/logger.js';


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

  private buildJudgePrompt(task: Task): string {
    return task.verification.judge_prompt ??
      `The agent was asked to complete this benchmark task:\n\n${task.prompt}\n\n` +
      'Evaluate whether the task was completed correctly using the files in the workspace and the agent output.';
  }

  /**
   * Run a single task with the specified agent.
   */
  async runTask(
    taskId: string,
    agent: Agent,
    skipVerify: boolean = false,
    runId?: string
  ): Promise<BenchmarkResult> {
    const task = await this.loader.loadById(taskId);
    return await this.executeTask(task, agent, skipVerify, runId);
  }

  /**
   * Run a single task against multiple models in parallel.
   */
  async runTaskParallel(
    taskId: string,
    runs: Array<{ agent: Agent; runId: string }>,
    skipVerify: boolean = false
  ): Promise<BenchmarkResult[]> {
    const task = await this.loader.loadById(taskId);

    return await Promise.all(
      runs.map(({ agent, runId }) => this.executeTask(task, agent, skipVerify, runId))
    );
  }

  /**
   * Run all tasks.
   */
  async runAll(agent: Agent, skipVerify: boolean = false, runId?: string): Promise<void> {
    const tasks = await this.loader.loadAll();

    const runLabel = runId ? `${agent.name()} (${runId})` : agent.name();
    logger.info(`Running ${tasks.length} tasks with agent: ${runLabel}`);

    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      logger.taskHeader(task.id, task.title);

      const result = await this.executeTask(task, agent, skipVerify, runId);
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
    const suite = createSuiteResults(runLabel, results);
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
  async runCategory(
    category: string,
    agent: Agent,
    skipVerify: boolean = false,
    runId?: string
  ): Promise<void> {
    const tasks = await this.loader.filterByCategory(category);

    if (tasks.length === 0) {
      logger.warn(`No tasks found for category: ${category}`);
      return;
    }

    const runLabel = runId ? `${agent.name()} (${runId})` : agent.name();
    logger.info(`Running ${tasks.length} tasks in category "${category}" with agent: ${runLabel}`);

    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      logger.taskHeader(task.id, task.title);

      const result = await this.executeTask(task, agent, skipVerify, runId);
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
    const suite = createSuiteResults(runLabel, results);
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
  private async executeTask(
    task: Task,
    agent: Agent,
    skipVerify: boolean,
    runId?: string
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();

    // Prepare workspace
    logger.info('Preparing workspace...');
    let workspacePath: string;
    try {
      workspacePath = await this.workspace.prepare(task, runId);
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

    try {
      // Determine the directory the agent should operate in.
      // When source.run_path is set the agent is scoped to that subdirectory
      // so it cannot accidentally touch files belonging to other tasks.
      const agentPath = this.workspace.getAgentPath(task, runId);
      if (agentPath !== workspacePath) {
        logger.debug(`Agent scoped to run_path: ${agentPath}`);
      }

      // Execute agent
      logger.info('Executing agent...');
      let agentResult;
      try {
        agentResult = await agent.execute(task, agentPath);
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
          agentResult.modelName,
          agentResult.inputTokens,
          agentResult.outputTokens,
          null,
        );
      } else {
        // LLM judge verification
        const judgeModel = this.config.judgeModel;
        logger.info(`Running LLM judge verification (${judgeModel})...`);
        try {
          const judgement = await callJudge(
            this.buildJudgePrompt(task),
            agentResult.output,
            judgeModel,
            agentPath,
          );

          logger.info(`Judge score: ${judgement.score}/100 — ${judgement.reasoning.split('\n')[0]}`);

          // Start with a base result; withJudgeScore overrides score + success
          result = withJudgeScore(
            createSuccess(
              task.id,
              agent.name(),
              agentResult.iterations,
              agentResult.tokensUsed,
              agentResult.durationSecs,
              agentResult.agentVersion,
              agentResult.modelName,
              agentResult.inputTokens,
              agentResult.outputTokens,
              judgement.judge_model,
            ),
            judgement.score,
          );

          result = withVerificationOutput(result, judgement.reasoning);
        } catch (error) {
          logger.error(`Judge error: ${error}`);
          result = createFailure(
            task.id,
            agent.name(),
            agentResult.iterations,
            agentResult.tokensUsed,
            agentResult.durationSecs,
            `Judge error: ${error}`,
            agentResult.agentVersion,
            agentResult.modelName,
            agentResult.inputTokens,
            agentResult.outputTokens,
            judgeModel,
          );
        }
      }

      // Add agent output
      result = withAgentOutput(result, agentResult.output);

      // Save result
      const resultPath = await saveResult(result, this.config.resultsDir);
      logger.debug(`Result saved to: ${resultPath}`);

      // Only clean up workspace on success; preserve it on failure for debugging
      if (result.success) {
        await this.workspace.cleanup(task, runId);
      } else {
        logger.warn(`Task failed — workspace preserved for debugging: ${agentPath}`);
      }

      return result;
    } catch (error) {
      // Unexpected error — preserve workspace for debugging
      logger.warn(`Unexpected error — workspace preserved for debugging: ${workspacePath}`);
      throw error;
    }
  }

  /**
   * List all available tasks.
   */
  async listTasks(): Promise<Task[]> {
    return await this.loader.loadAll();
  }
}
