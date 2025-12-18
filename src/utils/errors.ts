/**
 * Custom error types for Agent Bench.
 */

/**
 * Base exception for Agent Bench errors.
 */
export class BenchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Raised when a task is not found.
 */
export class TaskNotFoundError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Raised when a task has an invalid format.
 */
export class InvalidTaskFormatError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaskFormatError';
  }
}

/**
 * Raised when a task fails to load.
 */
export class TaskLoadError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'TaskLoadError';
  }
}

/**
 * Raised when an agent execution fails.
 */
export class AgentError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Raised when verification fails.
 */
export class VerificationError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

/**
 * Raised when an operation times out.
 */
export class TimeoutError extends BenchError {
  timeoutSecs: number;

  constructor(timeoutSecs: number) {
    super(`Timeout after ${timeoutSecs} seconds`);
    this.name = 'TimeoutError';
    this.timeoutSecs = timeoutSecs;
  }
}

/**
 * Raised when a git operation fails.
 */
export class GitError extends BenchError {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}
