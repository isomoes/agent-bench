/**
 * Base agent interface and types.
 */

import { Task } from '../core/task.js';

/**
 * Result from an agent execution.
 */
export interface AgentResult {
  success: boolean;
  output: string;
  iterations: number;
  tokensUsed: number | null;
  cost: number | null;
  durationSecs: number;
  agentVersion: string | null;
  modelName: string | null;
}

/**
 * Base interface for AI agent adapters.
 */
export interface Agent {
  /**
   * Get the agent's name.
   */
  name(): string;

  /**
   * Execute a task in the given workspace.
   * @param task The task to execute
   * @param workspace The workspace path
   * @returns Agent execution result
   */
  execute(task: Task, workspace: string): Promise<AgentResult>;
}

/**
 * Model configuration for OpenCode.
 */
export interface ModelConfig {
  providerID: string;
  modelID: string;
}

/**
 * Parse model string into ModelConfig.
 * Format: "provider/model" (e.g., "anthropic/claude-sonnet-4-5")
 */
export function parseModel(modelString: string): ModelConfig {
  const parts = modelString.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid model format: ${modelString}. Expected "provider/model"`);
  }
  return {
    providerID: parts[0],
    modelID: parts[1],
  };
}

/**
 * Default model configuration.
 */
export const DEFAULT_MODEL: ModelConfig = {
  providerID: 'anthropic',
  modelID: 'claude-sonnet-4-5',
};
