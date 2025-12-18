/**
 * Workspace management for task execution.
 */

import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { Task } from './task.js';
import { GitError } from '../utils/errors.js';

/**
 * Workspace manager for preparing and managing task workspaces.
 */
export class WorkspaceManager {
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Prepare a workspace for task execution.
   * @param task The task to prepare workspace for
   * @returns The path to the prepared workspace
   */
  async prepare(task: Task): Promise<string> {
    const workspace = join(this.workspaceDir, task.id);

    // Clean up existing workspace if it exists
    try {
      await rm(workspace, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }

    // Create workspace directory
    await mkdir(workspace, { recursive: true });

    // Clone repository if not "none"
    if (task.source.repository !== 'none' && task.source.repository) {
      await this.cloneRepo(task.source.repository, task.source.commit, workspace);
    }

    return workspace;
  }

  /**
   * Clone a repository to the workspace.
   * @param repoUrl Repository URL
   * @param commit Commit hash or branch name
   * @param workspace Workspace path
   */
  private async cloneRepo(repoUrl: string, commit: string, workspace: string): Promise<void> {
    try {
      const git: SimpleGit = simpleGit();

      // Clone the repository
      await git.clone(repoUrl, workspace);

      // If commit is "main", "master", or "HEAD", stay on default branch
      if (commit === 'main' || commit === 'master' || commit === 'HEAD') {
        return;
      }

      // Checkout specific commit or branch
      const repoGit = simpleGit(workspace);
      try {
        await repoGit.checkout(commit);
      } catch (error) {
        throw new GitError(`Failed to checkout '${commit}': ${error}`);
      }
    } catch (error) {
      if (error instanceof GitError) {
        throw error;
      }
      throw new GitError(`Failed to clone repository: ${error}`);
    }
  }

  /**
   * Clean up a workspace after task execution.
   * @param task The task whose workspace to clean up
   */
  async cleanup(task: Task): Promise<void> {
    const workspace = join(this.workspaceDir, task.id);
    try {
      await rm(workspace, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
      console.warn(`Warning: Failed to cleanup workspace ${workspace}:`, error);
    }
  }

  /**
   * Check if a workspace exists for a task.
   * @param task The task to check
   * @returns True if workspace exists
   */
  async exists(task: Task): Promise<boolean> {
    const workspace = join(this.workspaceDir, task.id);
    try {
      await mkdir(workspace, { recursive: false });
      // If we can create it, it didn't exist
      await rm(workspace, { recursive: true });
      return false;
    } catch {
      // If mkdir fails, directory exists
      return true;
    }
  }

  /**
   * Get the workspace path for a task.
   * @param task The task
   * @returns The workspace path
   */
  getPath(task: Task): string {
    return join(this.workspaceDir, task.id);
  }
}
