/**
 * Verification for task execution.
 */

import { spawn } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import { Buffer } from 'node:buffer';
import { Task } from '../core/task.js';
import { VerificationError } from '../utils/errors.js';

/** Default judge model used when no --judge-model flag is given. */
export const DEFAULT_JUDGE_MODEL = 'anthropic/claude-sonnet-4-6';

/**
 * Result from an LLM judge evaluation.
 */
export interface JudgeResult {
  /** Numeric score 0–100 assigned by the judge. 0 means complete failure. */
  score: number;
  /** Convenience: true when score > 0. */
  passed: boolean;
  /** The model ID that produced this judgement. */
  judge_model: string;
  /** The full raw response from the judge. */
  reasoning: string;
}

const MAX_EVIDENCE_FILES = 60;
const MAX_EVIDENCE_BYTES_PER_FILE = 8_000;

async function collectWorkspaceEvidence(workspacePath: string): Promise<string> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_EVIDENCE_FILES) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_EVIDENCE_FILES) {
        return;
      }

      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  try {
    await walk(workspacePath);
  } catch (error) {
    return `Unable to read workspace evidence: ${error}`;
  }

  if (files.length === 0) {
    return 'No files found in workspace.';
  }

  const sections: string[] = [];
  for (const file of files) {
    const relPath = relative(workspacePath, file);
    try {
      const fileStat = await stat(file);
      if (fileStat.size > MAX_EVIDENCE_BYTES_PER_FILE) {
        sections.push(`FILE: ${relPath}\nSIZE: ${fileStat.size} bytes\nCONTENT: <omitted: file too large>`);
        continue;
      }

      const content = await readFile(file, 'utf-8');
      sections.push(`FILE: ${relPath}\nSIZE: ${fileStat.size} bytes\nCONTENT:\n${content}`);
    } catch (error) {
      sections.push(`FILE: ${relPath}\nCONTENT: <unable to read: ${error}>`);
    }
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Call an LLM judge via the OpenCode SDK to evaluate agent output.
 *
 * A short-lived OpenCode session is created with the judge model.  The
 * judge receives the judge_prompt + agent output and must respond with a
 * line starting with PASS or FAIL followed by a brief reason.
 *
 * The judge model is resolved in priority order:
 *   1. judgeModel parameter (set by --judge-model CLI flag)
 *   2. DEFAULT_JUDGE_MODEL constant
 */
export async function callJudge(
  judgePrompt: string,
  agentOutput: string,
  judgeModel: string,
  workspacePath: string,
): Promise<JudgeResult> {
  const { createOpencodeClient, createOpencodeServer } = await import('@opencode-ai/sdk');

  const server = await createOpencodeServer({ port: 0 });

  // Mirror the same auth the benchmark agent uses
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  const headers: Record<string, string> | undefined = password
    ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }
    : undefined;
  const client = createOpencodeClient({ baseUrl: server.url, headers });

  try {
    // Parse "provider/model" into the ModelConfig shape OpenCode expects
    const slashIdx = judgeModel.indexOf('/');
    if (slashIdx === -1) {
      throw new VerificationError(
        `Invalid judge model format: "${judgeModel}". Expected "provider/model".`
      );
    }
    const providerID = judgeModel.slice(0, slashIdx);
    const modelID    = judgeModel.slice(slashIdx + 1);

    // Create a session in the task workspace so the judge can read result files
    const sessionResp = await client.session.create({
      query: { directory: workspacePath },
    });
    if (!sessionResp.data) {
      throw new VerificationError('Judge: failed to create OpenCode session');
    }
    const sessionId = sessionResp.data.id;

    const workspaceEvidence = await collectWorkspaceEvidence(workspacePath);

    const fullPrompt =
      'You are a strict benchmark evaluator. ' +
      'Evaluate how well the agent completed the task and assign a score from 0 to 100.\n' +
      'Use the workspace evidence below as the source of truth for files the agent created. ' +
      'Do not infer failure only because tool outputs are omitted from the transcript.\n' +
      '  100 = fully correct with no issues\n' +
      '  70-99 = mostly correct, minor issues\n' +
      '  1-69 = partially correct, significant issues\n' +
      '  0 = completely wrong or task not attempted\n\n' +
      'You MUST respond with exactly two lines and nothing else:\n' +
      'SCORE: <integer 0-100>\n' +
      'REASON: <one sentence explanation>\n\n' +
      `${judgePrompt}\n\n---\nWorkspace evidence:\n${workspaceEvidence}\n\n---\nAgent output:\n${agentOutput}`;

    // Send prompt and get synchronous response (parts returned directly)
    const promptResp = await client.session.prompt({
      path: { id: sessionId },
      query: { directory: workspacePath },
      body: {
        parts: [{ type: 'text', text: fullPrompt }],
        agent: 'plan',
        model: { providerID, modelID },
      },
    });

    // Extract text from response parts
    const parts = (promptResp as any)?.data?.parts ?? (promptResp as any)?.parts ?? [];
    const content: string = parts
      .filter((p: any) => p.type === 'text' && p.text)
      .map((p: any) => p.text as string)
      .join('\n')
      .trim();

    // Parse "SCORE: <n>" from the response
    const scoreMatch = content.match(/^SCORE:\s*(\d+)/im);
    const raw = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const score = Math.max(0, Math.min(100, raw));
    const passed = score > 0;

    return { score, passed, judge_model: judgeModel, reasoning: content };
  } finally {
    try { await server.close(); } catch { /* ignore */ }
  }
}

/**
 * Normalize command tokens when they still include the task run_path prefix.
 * This keeps backwards compatibility with commands like
 * "python3 TOOLS/001/verify.py" while running from that task directory.
 */
function stripRunPathPrefix(token: string, runPath: string): string {
  const withSlash = `${runPath}/`;
  if (token.startsWith(withSlash)) {
    return token.slice(withSlash.length);
  }

  const withDotSlash = `./${runPath}/`;
  if (token.startsWith(withDotSlash)) {
    return token.slice(withDotSlash.length);
  }

  return token;
}

/**
 * Verification result.
 */
export interface VerificationResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSecs: number;
}

/**
 * Verifier for running task verification commands.
 */
export class Verifier {
  /**
   * Run verification for a task in the given workspace.
   * @param task The task to verify
   * @param workspace The workspace root path
   * @returns Verification result
   */
  static async verify(task: Task, workspace: string): Promise<VerificationResult> {
    const startTime = Date.now();

    // Parse the command
    const commandParts = task.verification.command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (commandParts.length === 0) {
      throw new VerificationError('Empty verification command');
    }

    const verificationCwd = join(workspace, task.source.run_path);
    const firstToken = commandParts[0];
    if (!firstToken) {
      throw new VerificationError('Empty verification command');
    }
    const program = stripRunPathPrefix(firstToken.replace(/"/g, ''), task.source.run_path);
    const args = commandParts
      .slice(1)
      .map(arg => stripRunPathPrefix(arg.replace(/"/g, ''), task.source.run_path));

    // Execute command with timeout
    return new Promise((resolve, reject) => {
      const proc = spawn(program, args, {
        cwd: verificationCwd,
        timeout: task.verification.timeout * 1000, // Convert to milliseconds
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const durationSecs = (Date.now() - startTime) / 1000;
        resolve({
          passed: code === 0,
          exitCode: code,
          stdout,
          stderr,
          durationSecs,
        });
      });

      proc.on('error', (error) => {
        // Check if it's a timeout error
        if ((error as any).code === 'ETIMEDOUT') {
          reject(
            new VerificationError(
              `Verification command timed out after ${task.verification.timeout} seconds`
            )
          );
        } else {
          reject(new VerificationError(`Failed to execute verification command: ${error.message}`));
        }
      });

      // Additional timeout handling
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(
          new VerificationError(
            `Verification command timed out after ${task.verification.timeout} seconds`
          )
        );
      }, task.verification.timeout * 1000);

      proc.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }
}
