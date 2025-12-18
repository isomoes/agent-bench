/**
 * Configuration for Agent Bench.
 */

import { join } from 'path';
import { homedir, tmpdir } from 'os';

/**
 * Runner configuration.
 */
export interface RunnerConfig {
  tasksDir: string;
  resultsDir: string;
  workspaceDir: string;
  maxIterations: number;
}

/**
 * Create default configuration.
 */
export function createDefaultConfig(): RunnerConfig {
  return {
    tasksDir: join(process.cwd(), 'tasks'),
    resultsDir: join(process.cwd(), 'results'),
    workspaceDir: join(tmpdir(), 'agent-bench'),
    maxIterations: 1,
  };
}

/**
 * User configuration (stored in config file).
 */
export interface UserConfig {
  opencodeUrl?: string;
  defaultModel?: string;
  tasksDir?: string;
  resultsDir?: string;
  workspaceDir?: string;
}

/**
 * Get user config file path.
 */
export function getConfigPath(): string {
  return join(homedir(), '.config', 'agent-bench', 'config.json');
}

/**
 * Load user configuration from file.
 */
export async function loadUserConfig(): Promise<UserConfig> {
  try {
    const { readFile } = await import('fs/promises');
    const configPath = getConfigPath();
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

/**
 * Save user configuration to file.
 */
export async function saveUserConfig(config: UserConfig): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { dirname } = await import('path');

  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Merge user config with default config.
 */
export function mergeConfig(userConfig: UserConfig, defaultConfig: RunnerConfig): RunnerConfig {
  return {
    tasksDir: userConfig.tasksDir || defaultConfig.tasksDir,
    resultsDir: userConfig.resultsDir || defaultConfig.resultsDir,
    workspaceDir: userConfig.workspaceDir || defaultConfig.workspaceDir,
    maxIterations: defaultConfig.maxIterations,
  };
}
