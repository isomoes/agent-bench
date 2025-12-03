"""Base agent interface and types."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

from ..task import Task


@dataclass
class AgentResult:
    """Result from an agent execution."""

    success: bool
    output: str
    iterations: int
    tokens_used: Optional[int] = None


class Agent(ABC):
    """Base class for AI agent adapters."""

    @abstractmethod
    def name(self) -> str:
        """Get the agent's name."""
        pass

    @abstractmethod
    async def execute(self, task: Task, workspace: Path) -> AgentResult:
        """Execute a task in the given workspace."""
        pass


class AgentType(str, Enum):
    """Available agent types."""

    CLAUDE = "claude"
    CLAUDE_DEEPSEEK = "claude-deepseek"
    CLAUDE_KIMI = "claude-kimi"
    CLAUDE_BIGMODEL = "claude-bigmodel"


def create_agent(agent_type: AgentType) -> Agent:
    """Create an agent instance by type."""
    from .claude import ClaudeAgent

    if agent_type == AgentType.CLAUDE:
        return ClaudeAgent(cli_command="claude")
    elif agent_type == AgentType.CLAUDE_DEEPSEEK:
        return ClaudeAgent(cli_command="claude-deepseek", display_name="claude-deepseek")
    elif agent_type == AgentType.CLAUDE_KIMI:
        return ClaudeAgent(cli_command="claude-kimi", display_name="claude-kimi")
    elif agent_type == AgentType.CLAUDE_BIGMODEL:
        return ClaudeAgent(cli_command="claude-bigmodel", display_name="claude-bigmodel")
    else:
        raise ValueError(f"Unknown agent type: {agent_type}")
