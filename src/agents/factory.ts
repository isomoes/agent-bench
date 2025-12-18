/**
 * Agent factory for creating agent instances.
 */

import { OpencodeAgent } from './opencode.js';
import type { Agent, ModelConfig } from './types.js';
import { parseModel, DEFAULT_MODEL } from './types.js';

/**
 * Create an OpenCode agent with optional model configuration.
 * @param modelString Optional model string in format "provider/model" (e.g., "anthropic/claude-opus-4")
 * @returns Agent instance
 */
export function createAgent(modelString?: string): Agent {
  let modelConfig: ModelConfig;

  if (modelString) {
    try {
      modelConfig = parseModel(modelString);
    } catch (error) {
      console.warn(`Invalid model string: ${modelString}, using default`);
      modelConfig = DEFAULT_MODEL;
    }
  } else {
    modelConfig = DEFAULT_MODEL;
  }

  return new OpencodeAgent(modelConfig);
}

/**
 * Create an agent with custom configuration.
 * @param config Model configuration
 * @param agentName Agent name
 * @returns Agent instance
 */
export function createCustomAgent(config: ModelConfig, agentName?: string): Agent {
  return new OpencodeAgent(config, agentName);
}
