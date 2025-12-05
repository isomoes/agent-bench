"""Task definitions and loader for Agent Bench."""

from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field, field_validator

from .error import InvalidTaskFormatError, TaskLoadError, TaskNotFoundError


class TaskCategory(str, Enum):
    """Task category classification."""
    BUG_FIX = "bug-fix"
    FEATURE = "feature"
    REFACTOR = "refactor"
    TOOLS = "tools"


class Difficulty(str, Enum):
    """Task difficulty level."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class SourceConfig(BaseModel):
    """Source repository configuration."""
    repository: str
    commit: str


class VerificationConfig(BaseModel):
    """Verification configuration."""
    type: str = Field(alias="type")
    command: str
    timeout: int = 60

    class Config:
        populate_by_name = True


class PermissionsConfig(BaseModel):
    """Agent permissions configuration."""
    mode: Optional[str] = None
    write: bool = False
    read: bool = True
    bash: bool = False
    web_fetch: bool = False


class TaskMetadata(BaseModel):
    """Task metadata."""
    tags: List[str] = Field(default_factory=list)
    extra: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class Task(BaseModel):
    """A benchmark task definition."""
    id: str
    title: str
    category: TaskCategory
    difficulty: Difficulty
    source: SourceConfig
    prompt: str
    verification: VerificationConfig
    permissions: PermissionsConfig = Field(default_factory=PermissionsConfig)
    metadata: TaskMetadata = Field(default_factory=TaskMetadata)
    max_iterations: Optional[int] = None

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        if not v:
            raise ValueError("Task ID cannot be empty")
        return v

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        if not v:
            raise ValueError("Task title cannot be empty")
        return v

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, v: str) -> str:
        if not v:
            raise ValueError("Task prompt cannot be empty")
        return v

    @classmethod
    def from_file(cls, path: Path) -> "Task":
        """Load a task from a YAML file."""
        try:
            with open(path, "r") as f:
                data = yaml.safe_load(f)
            return cls.model_validate(data)
        except FileNotFoundError:
            raise TaskLoadError(f"Failed to read {path}: file not found")
        except yaml.YAMLError as e:
            raise TaskLoadError(f"Failed to parse {path}: {e}")
        except Exception as e:
            raise TaskLoadError(f"Failed to load {path}: {e}")

    def validate_task(self) -> None:
        """Validate the task configuration."""
        if not self.source.repository:
            raise InvalidTaskFormatError("Source repository cannot be empty")
        if not self.source.commit:
            raise InvalidTaskFormatError("Source commit cannot be empty")
        if not self.verification.command:
            raise InvalidTaskFormatError("Verification command cannot be empty")


class TaskLoader:
    """Task loader for discovering and loading benchmark tasks."""

    def __init__(self, tasks_dir: Path):
        self.tasks_dir = Path(tasks_dir)

    def load_all(self) -> List[Task]:
        """Load all tasks from the tasks directory."""
        tasks: List[Task] = []

        if not self.tasks_dir.exists():
            return tasks

        self._load_recursive(self.tasks_dir, tasks)
        return tasks

    def _load_recursive(self, directory: Path, tasks: List[Task]) -> None:
        """Recursively load tasks from a directory."""
        for path in directory.iterdir():
            if path.is_dir():
                self._load_recursive(path, tasks)
            elif path.suffix in {".yaml", ".yml"}:
                try:
                    task = Task.from_file(path)
                    tasks.append(task)
                except Exception as e:
                    print(f"Warning: Failed to load {path}: {e}")

    def load_by_id(self, task_id: str) -> Task:
        """Load a specific task by ID."""
        tasks = self.load_all()
        for task in tasks:
            if task.id == task_id:
                return task
        raise TaskNotFoundError(task_id)

    def list_ids(self) -> List[str]:
        """List all available task IDs."""
        tasks = self.load_all()
        return [task.id for task in tasks]
