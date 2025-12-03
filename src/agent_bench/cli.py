"""Command-line interface for Agent Bench."""

import asyncio
import logging
from pathlib import Path

import click

from .agents import AgentType
from .collect_results import collect_results, write_csv
from .runner import RunnerConfig, TaskRunner


@click.group()
@click.option("--tasks-dir", default="tasks", type=click.Path(), help="Tasks directory")
@click.option("--results-dir", default="results", type=click.Path(), help="Results directory")
@click.option(
    "--workspace-dir", default="/tmp/agent-bench", type=click.Path(), help="Workspace directory"
)
@click.option("--debug", is_flag=True, help="Enable debug logging")
@click.pass_context
def cli(ctx: click.Context, tasks_dir: str, results_dir: str, workspace_dir: str, debug: bool):
    """Agent Bench - Benchmark for evaluating AI coding agents."""
    # Set up logging
    if debug:
        logging.basicConfig(level=logging.DEBUG, format="%(levelname)s: %(message)s")
    else:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # Store config in context
    ctx.obj = RunnerConfig(
        tasks_dir=Path(tasks_dir),
        results_dir=Path(results_dir),
        workspace_dir=Path(workspace_dir),
        max_iterations=1,
    )


@cli.command()
@click.option("-v", "--verbose", is_flag=True, help="Show detailed information")
@click.pass_context
def list(ctx: click.Context, verbose: bool):
    """List available benchmark tasks."""
    config: RunnerConfig = ctx.obj
    runner = TaskRunner(config)
    tasks = runner.list_tasks()

    if not tasks:
        click.echo(f"No tasks found in {config.tasks_dir}")
        return

    click.echo(f"Available tasks ({len(tasks)}):\n")

    for task in tasks:
        if verbose:
            click.echo(f"{task.id}:")
            click.echo(f"  Title:      {task.title}")
            click.echo(f"  Category:   {task.category.value}")
            click.echo(f"  Difficulty: {task.difficulty.value}")
            click.echo(f"  Repository: {task.source.repository}")
            click.echo(f"  Commit:     {task.source.commit}")
            if task.metadata.tags:
                click.echo(f"  Tags:       {', '.join(task.metadata.tags)}")
            click.echo()
        else:
            click.echo(
                f"  {task.id} - {task.title} [{task.category.value}] ({task.difficulty.value})"
            )


@cli.command()
@click.option("--task", help="Specific task ID to run")
@click.option("--suite", help="Run all tasks in the suite")
@click.option("--agent", default="claude", help="Agent to use for execution")
@click.pass_context
def run(ctx: click.Context, task: str, suite: str, agent: str):
    """Run benchmark tasks."""
    config: RunnerConfig = ctx.obj
    runner = TaskRunner(config)

    try:
        agent_type = AgentType(agent.lower())
    except ValueError:
        click.echo(f"Error: Unknown agent type: {agent}")
        return

    if task:
        # Run a single task
        click.echo(f"Running task: {task}")

        result = asyncio.run(runner.run_task(task, agent_type))

        click.echo("\n=== Results ===")
        click.echo(f"Task:       {result.task_id}")
        click.echo(f"Agent:      {result.agent}")
        click.echo(f"Status:     {'PASS' if result.success else 'FAIL'}")
        click.echo(f"Score:      {result.score}")
        click.echo(f"Iterations: {result.iterations}")
        click.echo(f"Duration:   {result.duration_secs:.2f}s")
        if result.tokens_used:
            click.echo(f"Tokens:     {result.tokens_used}")
        if result.error:
            click.echo(f"Error:      {result.error}")

    elif suite:
        # Run all tasks
        click.echo("Running full benchmark suite...\n")

        suite_results = asyncio.run(runner.run_all(agent_type))

        click.echo("\n=== Suite Results ===")
        click.echo(f"Agent:         {suite_results.agent}")
        click.echo(f"Total tasks:   {suite_results.total_tasks}")
        click.echo(f"Passed:        {suite_results.passed}")
        click.echo(f"Failed:        {suite_results.failed}")
        click.echo(f"Pass rate:     {suite_results.pass_rate * 100:.1f}%")
        click.echo(f"Total time:    {suite_results.total_duration_secs:.2f}s")

    else:
        click.echo("Error: Either --task <ID> or --suite all must be specified")
        click.echo("\nUsage:")
        click.echo("  agent-bench run --task <TASK_ID> --agent <AGENT>")
        click.echo("  agent-bench run --suite all --agent <AGENT>")


@cli.command()
@click.option("-o", "--output", default=None, help="Output CSV file path (default: results/summary.csv)")
@click.pass_context
def collect(ctx: click.Context, output: str):
    """Collect all benchmark results into a single CSV file."""
    config: RunnerConfig = ctx.obj

    # Determine output path
    if output:
        output_path = Path(output)
    else:
        output_path = config.results_dir / "summary.csv"

    click.echo(f"Collecting results from {config.results_dir}...")
    results = collect_results(config.results_dir)

    if not results:
        click.echo("No results found.")
        return

    click.echo(f"Found {len(results)} result files")

    write_csv(results, output_path)
    click.echo(f"\n✓ Results summary available at: {output_path}")


def main():
    """Entry point for the CLI."""
    cli(obj=None)


if __name__ == "__main__":
    main()
