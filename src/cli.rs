use clap::{Parser, Subcommand};
use std::path::PathBuf;

use crate::agents::AgentType;
use crate::error::Result;
use crate::runner::{RunnerConfig, TaskRunner};

/// Agent Bench - Benchmark for evaluating AI coding agents
#[derive(Parser, Debug)]
#[command(name = "agent-bench")]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    /// Tasks directory
    #[arg(long, default_value = "tasks")]
    pub tasks_dir: PathBuf,

    /// Results directory
    #[arg(long, default_value = "results")]
    pub results_dir: PathBuf,

    /// Workspace directory for task execution
    #[arg(long, default_value = "/tmp/agent-bench")]
    pub workspace_dir: PathBuf,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// List available benchmark tasks
    List {
        /// Show detailed information
        #[arg(short, long)]
        verbose: bool,
    },

    /// Run benchmark tasks
    Run {
        /// Specific task ID to run
        #[arg(long)]
        task: Option<String>,

        /// Run all tasks in the suite
        #[arg(long)]
        suite: Option<String>,

        /// Agent to use for execution
        #[arg(long, default_value = "claude")]
        agent: String,
    },
}

impl Cli {
    /// Create a runner configuration from CLI arguments
    pub fn to_runner_config(&self) -> RunnerConfig {
        RunnerConfig {
            tasks_dir: self.tasks_dir.clone(),
            results_dir: self.results_dir.clone(),
            workspace_dir: self.workspace_dir.clone(),
            max_iterations: 1,
        }
    }
}

/// Execute the list command
pub async fn cmd_list(cli: &Cli, verbose: bool) -> Result<()> {
    let runner = TaskRunner::new(cli.to_runner_config());
    let tasks = runner.list_tasks()?;

    if tasks.is_empty() {
        println!("No tasks found in {}", cli.tasks_dir.display());
        return Ok(());
    }

    println!("Available tasks ({}):\n", tasks.len());

    for task in tasks {
        if verbose {
            println!("{}:", task.id);
            println!("  Title:      {}", task.title);
            println!("  Category:   {}", task.category);
            println!("  Difficulty: {}", task.difficulty);
            println!("  Repository: {}", task.source.repository);
            println!("  Commit:     {}", task.source.commit);
            if !task.metadata.tags.is_empty() {
                println!("  Tags:       {}", task.metadata.tags.join(", "));
            }
            println!();
        } else {
            println!(
                "  {} - {} [{}] ({})",
                task.id, task.title, task.category, task.difficulty
            );
        }
    }

    Ok(())
}

/// Execute the run command
pub async fn cmd_run(
    cli: &Cli,
    task_id: Option<String>,
    suite: Option<String>,
    agent_name: String,
) -> Result<()> {
    let runner = TaskRunner::new(cli.to_runner_config());

    let agent_type: AgentType = agent_name
        .parse()
        .map_err(|e: String| crate::error::BenchError::AgentError(e))?;

    match (task_id, suite) {
        (Some(id), _) => {
            // Run a single task
            println!("Running task: {}", id);
            let result = runner.run_task(&id, agent_type).await?;

            println!("\n=== Results ===");
            println!("Task:      {}", result.task_id);
            println!("Agent:     {}", result.agent);
            println!("Status:    {}", if result.success { "PASS" } else { "FAIL" });
            println!("Score:     {}", result.score);
            println!("Iterations: {}", result.iterations);
            println!("Duration:  {:.2}s", result.duration_secs);
            if let Some(tokens) = result.tokens_used {
                println!("Tokens:    {}", tokens);
            }
            if let Some(ref error) = result.error {
                println!("Error:     {}", error);
            }
        }
        (None, Some(_)) => {
            // Run all tasks
            println!("Running full benchmark suite...\n");
            let suite_results = runner.run_all(agent_type).await?;

            println!("\n=== Suite Results ===");
            println!("Agent:         {}", suite_results.agent);
            println!("Total tasks:   {}", suite_results.total_tasks);
            println!("Passed:        {}", suite_results.passed);
            println!("Failed:        {}", suite_results.failed);
            println!("Pass rate:     {:.1}%", suite_results.pass_rate * 100.0);
            println!("Total time:    {:.2}s", suite_results.total_duration_secs);
        }
        (None, None) => {
            println!("Error: Either --task <ID> or --suite all must be specified");
            println!("\nUsage:");
            println!("  agent-bench run --task <TASK_ID> --agent <AGENT>");
            println!("  agent-bench run --suite all --agent <AGENT>");
        }
    }

    Ok(())
}
