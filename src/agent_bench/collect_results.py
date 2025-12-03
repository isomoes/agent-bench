"""Collect and consolidate benchmark results into CSV format."""

import csv
import json
from pathlib import Path
from typing import Any


def load_result(file_path: Path) -> dict[str, Any]:
    """Load a single result JSON file."""
    with open(file_path) as f:
        return json.load(f)


def collect_results(results_dir: Path = Path("results")) -> list[dict[str, Any]]:
    """Collect all JSON result files from the results directory."""
    json_files = sorted(results_dir.glob("*.json"))
    results = []

    for json_file in json_files:
        try:
            result = load_result(json_file)
            results.append(result)
        except Exception as e:
            print(f"Warning: Failed to load {json_file}: {e}")

    return results


def write_csv(results: list[dict[str, Any]], output_path: Path) -> None:
    """Write results to a CSV file."""
    if not results:
        print("No results to write")
        return

    # Define CSV columns
    fieldnames = [
        "task_id",
        "agent",
        "timestamp",
        "success",
        "score",
        "iterations",
        "duration_secs",
        "tokens_used",
        "error",
    ]

    with open(output_path, "w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()

        for result in results:
            # Extract only the fields we want for CSV
            row = {
                "task_id": result.get("task_id", ""),
                "agent": result.get("agent", ""),
                "timestamp": result.get("timestamp", ""),
                "success": result.get("success", False),
                "score": result.get("score", 0),
                "iterations": result.get("iterations", 0),
                "duration_secs": round(result.get("duration_secs", 0), 2),
                "tokens_used": result.get("tokens_used", ""),
                "error": result.get("error", "")[:100] if result.get("error") else "",  # Truncate long errors
            }
            writer.writerow(row)

    print(f"✓ Wrote {len(results)} results to {output_path}")


def main() -> None:
    """Main entry point for collecting results."""
    results_dir = Path("results")
    output_path = results_dir / "summary.csv"

    print(f"Collecting results from {results_dir}...")
    results = collect_results(results_dir)
    print(f"Found {len(results)} result files")

    write_csv(results, output_path)
    print(f"\nResults summary available at: {output_path}")


if __name__ == "__main__":
    main()
