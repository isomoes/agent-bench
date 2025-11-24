# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Agent Bench is an open-source benchmark for evaluating AI coding agents on real-world engineering tasks. It creates reproducible evaluation environments derived from authentic development tasks.

## Tech Stack

- **Language**: Rust 1.75+
- **Build System**: Cargo

## Build Commands

```bash
# Build the project
cargo build --release

# Run tests
cargo test

# Run with debug output
cargo run -- <command>
```

## Project Structure

```
agent-bench/
├── src/
│   ├── main.rs             # Entry point
│   ├── cli.rs              # Command-line interface
│   ├── task.rs             # Task model and loader
│   ├── runner.rs           # Task execution
│   ├── agents/             # Agent adapters
│   │   ├── mod.rs
│   │   └── claude.rs
│   └── evaluator.rs        # Result verification
├── tasks/                  # Benchmark tasks (YAML format)
│   └── examples/
└── results/                # Run outputs
```

## CLI Usage

```bash
# List available tasks
agent-bench list

# Run a specific task
agent-bench run --task <task-id> --agent <agent-name>

# Run full benchmark suite
agent-bench run --suite all --agent <agent-name>
```

## Task Format

Tasks are defined in YAML with the following structure:
- `id`: Unique identifier (e.g., BUG-001)
- `title`: Brief description
- `category`: Task type (bug-fix, feature, refactor)
- `difficulty`: easy, medium, hard
- `source`: Repository URL and commit hash
- `prompt`: Task instructions for the agent
- `verification`: Test command and timeout
- `metadata`: Tags for categorization

## Architecture

```
CLI → Core (Task Loader, Runner) → Agent Adapter → Evaluator (Verifier, Results)
```

## Key Metrics

- **Score**: 0-100 scale measuring solution quality and completeness
- **Iterations**: Attempts before success
- **Token Usage**: Tokens consumed
- **Duration**: Time to completion

## Development Status

MVP phase focusing on:
- Task loader and validator
- Single agent adapter (Claude)
- Basic runner (local execution)
- Test-based verification
- JSON results output

## Important Reminders

- **When completing a TODO item**: Update `TODO.md` to mark the item as done by changing `- [ ]` to `- [x]`
