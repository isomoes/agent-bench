pub mod claude;

use async_trait::async_trait;
use std::path::Path;

use crate::error::Result;
use crate::task::Task;

/// Result from an agent execution
#[derive(Debug, Clone)]
pub struct AgentResult {
    /// Whether the agent completed successfully
    pub success: bool,
    /// Agent's output/response
    pub output: String,
    /// Number of iterations/attempts
    pub iterations: u32,
    /// Token usage (if available)
    pub tokens_used: Option<u64>,
}

/// Trait for AI agent adapters
#[async_trait]
pub trait Agent: Send + Sync {
    /// Get the agent's name
    fn name(&self) -> &str;

    /// Execute a task in the given workspace
    async fn execute(&self, task: &Task, workspace: &Path) -> Result<AgentResult>;
}

/// Available agent types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentType {
    Claude,
}

impl std::str::FromStr for AgentType {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "claude" => Ok(AgentType::Claude),
            _ => Err(format!("Unknown agent type: {}", s)),
        }
    }
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentType::Claude => write!(f, "claude"),
        }
    }
}

/// Create an agent instance by type
pub fn create_agent(agent_type: AgentType) -> Box<dyn Agent> {
    match agent_type {
        AgentType::Claude => Box::new(claude::ClaudeAgent::new()),
    }
}
