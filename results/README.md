# Benchmark Results

This directory contains benchmark run results in JSON format. Each file represents a single task execution.

## File Naming Convention

Files are named: `{task_id}_{agent}_{timestamp}_{status}.json`

Example: `TOOLS-001_claude_20251203_120252_pass.json`

## JSON Result Format

Each result file contains:
- `task_id`: Task identifier
- `agent`: Agent name that ran the task
- `timestamp`: ISO 8601 timestamp
- `success`: Boolean indicating pass/fail
- `score`: Score from 0-100
- `iterations`: Number of attempts
- `duration_secs`: Execution time in seconds
- `tokens_used`: Token count (if available)
- `verification_output`: Test execution output
- `agent_output`: Agent's final response
- `error`: Error message (if failed)

## CSV Summary

Run `agent-bench collect` to generate `summary.csv` containing all results in a single file for easy comparison.

### CSV Columns

- `task_id`: Task identifier
- `agent`: Agent name
- `timestamp`: Execution timestamp
- `success`: Pass/fail status
- `score`: Score (0-100)
- `iterations`: Number of attempts
- `duration_secs`: Execution time
- `tokens_used`: Token usage
- `error`: Error message (truncated to 100 chars)

## Usage

```bash
# Generate CSV summary
agent-bench collect

# View in terminal
column -t -s, results/summary.csv

# Open in spreadsheet software
open results/summary.csv
```
