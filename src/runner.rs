use std::path::{Path, PathBuf};

use crate::agents::{create_agent, Agent, AgentType};
use crate::error::{BenchError, Result};
use crate::evaluator::{BenchmarkResult, SuiteResults, Verifier};
use crate::task::{Task, TaskLoader};

/// Configuration for the task runner
#[derive(Debug, Clone)]
pub struct RunnerConfig {
    /// Directory containing tasks
    pub tasks_dir: PathBuf,
    /// Directory for storing results
    pub results_dir: PathBuf,
    /// Directory for workspaces
    pub workspace_dir: PathBuf,
    /// Maximum iterations per task
    pub max_iterations: u32,
}

impl Default for RunnerConfig {
    fn default() -> Self {
        Self {
            tasks_dir: PathBuf::from("tasks"),
            results_dir: PathBuf::from("results"),
            workspace_dir: PathBuf::from("/tmp/agent-bench"),
            max_iterations: 1,
        }
    }
}

/// Task runner for executing benchmarks
pub struct TaskRunner {
    config: RunnerConfig,
}

impl TaskRunner {
    /// Create a new task runner with the given configuration
    pub fn new(config: RunnerConfig) -> Self {
        Self { config }
    }

    /// Create a task runner with default configuration
    pub fn with_defaults() -> Self {
        Self::new(RunnerConfig::default())
    }

    /// Run a single task with the specified agent
    pub async fn run_task(&self, task_id: &str, agent_type: AgentType) -> Result<BenchmarkResult> {
        let loader = TaskLoader::new(&self.config.tasks_dir);
        let task = loader.load_by_id(task_id)?;
        let agent = create_agent(agent_type);

        self.execute_task(&task, agent.as_ref()).await
    }

    /// Run all tasks with the specified agent
    pub async fn run_all(&self, agent_type: AgentType) -> Result<SuiteResults> {
        let loader = TaskLoader::new(&self.config.tasks_dir);
        let tasks = loader.load_all()?;
        let agent = create_agent(agent_type);

        let mut results = Vec::new();
        for task in tasks {
            println!("Running task: {} - {}", task.id, task.title);
            let result = self.execute_task(&task, agent.as_ref()).await?;
            println!(
                "  Result: {} (score: {}, duration: {:.2}s)",
                if result.success { "PASS" } else { "FAIL" },
                result.score,
                result.duration_secs
            );
            results.push(result);
        }

        let suite = SuiteResults::from_results(agent.name().to_string(), results);
        let path = suite.save(&self.config.results_dir)?;
        println!("\nSuite results saved to: {}", path.display());

        Ok(suite)
    }

    /// Execute a single task
    async fn execute_task(&self, task: &Task, agent: &dyn Agent) -> Result<BenchmarkResult> {
        let start = std::time::Instant::now();

        // Prepare workspace
        let workspace = self.prepare_workspace(task)?;

        // Execute agent
        let agent_result = match agent.execute(task, &workspace).await {
            Ok(result) => result,
            Err(e) => {
                let duration = start.elapsed().as_secs_f64();
                return Ok(BenchmarkResult::failure(
                    task.id.clone(),
                    agent.name().to_string(),
                    0,
                    None,
                    duration,
                    format!("Agent execution failed: {}", e),
                ));
            }
        };

        // Run verification
        let verification = match Verifier::verify(task, &workspace).await {
            Ok(v) => v,
            Err(e) => {
                let duration = start.elapsed().as_secs_f64();
                return Ok(BenchmarkResult::failure(
                    task.id.clone(),
                    agent.name().to_string(),
                    agent_result.iterations,
                    agent_result.tokens_used,
                    duration,
                    format!("Verification failed: {}", e),
                )
                .with_agent_output(agent_result.output));
            }
        };

        let duration = start.elapsed().as_secs_f64();

        let result = if verification.passed {
            BenchmarkResult::success(
                task.id.clone(),
                agent.name().to_string(),
                agent_result.iterations,
                agent_result.tokens_used,
                duration,
            )
        } else {
            BenchmarkResult::failure(
                task.id.clone(),
                agent.name().to_string(),
                agent_result.iterations,
                agent_result.tokens_used,
                duration,
                "Verification tests failed".to_string(),
            )
        }
        .with_agent_output(agent_result.output)
        .with_verification_output(format!(
            "Exit code: {:?}\n\nSTDOUT:\n{}\n\nSTDERR:\n{}",
            verification.exit_code, verification.stdout, verification.stderr
        ));

        // Save individual result
        let path = result.save(&self.config.results_dir)?;
        println!("Result saved to: {}", path.display());

        Ok(result)
    }

    /// Prepare a workspace for task execution
    fn prepare_workspace(&self, task: &Task) -> Result<PathBuf> {
        let workspace = self.config.workspace_dir.join(&task.id);

        // Clean up existing workspace if it exists
        if workspace.exists() {
            std::fs::remove_dir_all(&workspace).map_err(|e| {
                BenchError::IoError(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to clean workspace: {}", e),
                ))
            })?;
        }

        // Clone the repository only if not "none"
        if task.source.repository != "none" && !task.source.repository.is_empty() {
            self.clone_repo(&task.source.repository, &task.source.commit, &workspace)?;
        } else {
            // Create empty workspace directory for tasks that don't need a repository
            std::fs::create_dir_all(&workspace).map_err(|e| {
                BenchError::IoError(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to create workspace: {}", e),
                ))
            })?;
        }

        Ok(workspace)
    }

    /// Clone a repository to the workspace
    fn clone_repo(&self, repo_url: &str, commit: &str, workspace: &Path) -> Result<()> {
        // Clone the repository
        let repo = git2::Repository::clone(repo_url, workspace)
            .map_err(|e| BenchError::GitError(format!("Failed to clone repository: {}", e)))?;

        // If commit is "main", "master", or a branch name, check it out as a branch
        // Otherwise, treat it as a commit hash
        if commit == "main" || commit == "master" || commit == "HEAD" {
            // For branch names, just use the default HEAD (already on the branch after clone)
            return Ok(());
        }

        // Try to parse as a commit hash
        if let Ok(oid) = git2::Oid::from_str(commit) {
            let commit_obj = repo
                .find_commit(oid)
                .map_err(|e| BenchError::GitError(format!("Commit not found: {}", e)))?;

            repo.checkout_tree(commit_obj.as_object(), None)
                .map_err(|e| BenchError::GitError(format!("Failed to checkout: {}", e)))?;

            repo.set_head_detached(oid)
                .map_err(|e| BenchError::GitError(format!("Failed to set HEAD: {}", e)))?;
        } else {
            // Try as a branch name
            let branch = repo
                .find_branch(commit, git2::BranchType::Remote)
                .or_else(|_| repo.find_branch(commit, git2::BranchType::Local))
                .map_err(|e| BenchError::GitError(format!("Branch or commit '{}' not found: {}", commit, e)))?;

            let commit_obj = branch.get().peel_to_commit()
                .map_err(|e| BenchError::GitError(format!("Failed to get commit from branch: {}", e)))?;

            repo.checkout_tree(commit_obj.as_object(), None)
                .map_err(|e| BenchError::GitError(format!("Failed to checkout: {}", e)))?;
        }

        Ok(())
    }

    /// List all available tasks
    pub fn list_tasks(&self) -> Result<Vec<Task>> {
        let loader = TaskLoader::new(&self.config.tasks_dir);
        loader.load_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runner_config_default() {
        let config = RunnerConfig::default();
        assert_eq!(config.tasks_dir, PathBuf::from("tasks"));
        assert_eq!(config.results_dir, PathBuf::from("results"));
        assert_eq!(config.max_iterations, 1);
    }
}
