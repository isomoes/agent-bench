/**
 * Task definitions and schemas for Agent Bench.
 *
 * Convention: every task lives at tasks/<CATEGORY>/<NNN>/task.yaml and its
 * verify script at tasks/<CATEGORY>/<NNN>/verify.py.  The task ID encodes
 * both pieces of information as "<CATEGORY>-<NNN>" (e.g. "TOOLS-001"), so
 * source repository details, run_path, and verification command are derived
 * automatically by default. Task YAML may still override these values when
 * needed (for example, custom run_path layouts).
 */

import { z } from 'zod';

/** Shared repository for all benchmark tasks. */
export const TASKS_REPOSITORY = 'https://github.com/isomoes/agent-bench-tasks.git';
/** Default branch used when cloning the tasks repository. */
export const TASKS_COMMIT = 'main';

/**
 * Task category classification.
 */
export const TaskCategorySchema = z.enum(['coding', 'writing', 'tools', 'bug-fix', 'feature', 'refactor']);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

/**
 * Task difficulty level.
 */
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * Source repository configuration for a resolved task.
 */
export interface SourceConfig {
  /** URL of the tasks repository. */
  repository: string;
  /** Branch or commit to check out. */
  commit: string;
  /** Subdirectory inside the workspace the agent should treat as its root. */
  run_path: string;
}

/**
 * Optional source overrides accepted from YAML.
 * Any missing value is derived from defaults and task ID.
 */
const SourceConfigOverrideSchema = z.object({
  repository: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  run_path: z.string().min(1).optional(),
});

/**
 * Verification configuration.
 * Only `timeout` needs to be stored in the YAML; `type` and `command` are derived.
 *
 * Verification is performed by an LLM judge by default. When `judge_prompt` is
 * set, it gives task-specific scoring guidance; otherwise the task prompt is
 * used to build a generic judge prompt.
 *
 * `judge_model` overrides the default judge model for this specific task.
 */
export const VerificationConfigSchema = z.object({
  type: z.string().default('python'),
  command: z.string().optional(),   // derived when absent
  timeout: z.number().int().positive().default(60),
  /** Task-specific scoring guidance sent to the LLM judge. */
  judge_prompt: z.string().optional(),
});
export type VerificationConfig = z.infer<typeof VerificationConfigSchema> & { command: string };

/**
 * Agent permissions configuration.
 */
export const PermissionsConfigSchema = z.object({
  mode: z.enum(['dontAsk', 'bypassPermissions', 'default']).optional(),
  write: z.boolean().default(false),
  read: z.boolean().default(true),
  bash: z.boolean().default(false),
  web_fetch: z.boolean().default(false),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Task metadata.
 */
export const TaskMetadataSchema = z.object({
  tags: z.array(z.string()).optional().default([]),
}).passthrough(); // Allow extra fields
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

/**
 * Raw schema used to parse the YAML file.
 * Required fields plus optional override fields from YAML.
 */
export const TaskRawSchema = z.object({
  id: z.string().min(1, 'Task ID cannot be empty'),
  title: z.string().min(1, 'Task title cannot be empty'),
  category: TaskCategorySchema,
  difficulty: DifficultySchema,
  prompt: z.string().min(1, 'Task prompt cannot be empty'),
  source: SourceConfigOverrideSchema.optional().default({}),
  verification: VerificationConfigSchema.default({}),
  permissions: PermissionsConfigSchema.default({}),
  metadata: TaskMetadataSchema.optional().default({ tags: [] }),
  max_iterations: z.number().int().positive().optional(),
  timeout: z.number().int().positive().default(180),
});
export type TaskRaw = z.infer<typeof TaskRawSchema>;

/**
 * A fully-resolved benchmark task definition.
 * All fields are present; derived fields are filled in by the loader.
 */
export interface Task extends TaskRaw {
  source: SourceConfig;
  verification: VerificationConfig;
}

/**
 * Derive the run_path for a task from its ID.
 * "TOOLS-001" → "TOOLS/001", "CODING-003" → "CODING/003"
 * @param taskId The task ID in CATEGORY-NNN format
 * @returns The relative path inside the cloned workspace
 */
export function deriveRunPath(taskId: string): string {
  const match = taskId.match(/^([A-Z][A-Z0-9-]*)-(\d+)$/);
  if (!match) {
    throw new Error(`Cannot derive run_path from task ID: ${taskId}`);
  }
  return `${match[1]}/${match[2]}`;
}

/**
 * Derive the verification command for a task from its ID.
 * Verification runs from the task's run_path, so the script path is local.
 * "TOOLS-001" → "python3 verify.py"
 * @param taskId The task ID
 * @returns The shell command to run the verification script
 */
export function deriveVerifyCommand(_taskId: string): string {
  return 'python3 verify.py';
}

/**
 * Build a fully-resolved Task from raw YAML data.
 * @param raw Parsed and validated raw task data
 * @returns Fully-resolved Task with all derived fields populated
 */
export function resolveTask(raw: TaskRaw): Task {
  const runPath = raw.source.run_path ?? deriveRunPath(raw.id);
  return {
    ...raw,
    source: {
      repository: raw.source.repository ?? TASKS_REPOSITORY,
      commit: raw.source.commit ?? TASKS_COMMIT,
      run_path: runPath,
    },
    verification: {
      ...raw.verification,
      command: raw.verification.command ?? deriveVerifyCommand(raw.id),
    },
  };
}

/**
 * Validate a task configuration.
 * @throws Error if required derived fields cannot be computed
 */
export function validateTask(task: Task): void {
  if (!task.source.repository) {
    throw new Error('Source repository cannot be empty');
  }
  if (!task.source.commit) {
    throw new Error('Source commit cannot be empty');
  }
  if (!task.verification.command) {
    throw new Error('Verification command cannot be empty');
  }
}
