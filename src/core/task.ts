/**
 * Task definitions and schemas for Agent Bench.
 */

import { z } from 'zod';

/**
 * Task category classification.
 */
export const TaskCategorySchema = z.enum(['bug-fix', 'feature', 'refactor', 'tools']);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

/**
 * Task difficulty level.
 */
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * Source repository configuration.
 */
export const SourceConfigSchema = z.object({
  repository: z.string().min(1, 'Source repository cannot be empty'),
  commit: z.string().min(1, 'Source commit cannot be empty'),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

/**
 * Verification configuration.
 */
export const VerificationConfigSchema = z.object({
  type: z.string(),
  command: z.string().min(1, 'Verification command cannot be empty'),
  timeout: z.number().int().positive().default(60),
});
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;

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
 * A benchmark task definition.
 */
export const TaskSchema = z.object({
  id: z.string().min(1, 'Task ID cannot be empty'),
  title: z.string().min(1, 'Task title cannot be empty'),
  category: TaskCategorySchema,
  difficulty: DifficultySchema,
  source: SourceConfigSchema,
  prompt: z.string().min(1, 'Task prompt cannot be empty'),
  verification: VerificationConfigSchema,
  permissions: PermissionsConfigSchema.default({}),
  metadata: TaskMetadataSchema.optional().default({ tags: [] }),
  max_iterations: z.number().int().positive().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * Validate a task configuration.
 * @throws InvalidTaskFormatError if validation fails
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
