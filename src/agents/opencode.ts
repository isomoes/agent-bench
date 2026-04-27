/**
 * OpenCode SDK agent adapter.
 */

import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { Buffer } from "node:buffer";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Task } from "../core/task.js";
import { AgentError } from "../utils/errors.js";
import type { Agent, AgentResult, ModelConfig } from "./types.js";
import { DEFAULT_MODEL } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get OpenCode SDK version from package.json.
 */
function getOpencodeVersion(): string {
  try {
    const packageJsonPath = join(__dirname, "../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const version = packageJson.dependencies?.["@opencode-ai/sdk"];
    if (version) {
      // Remove ^ or ~ prefix if present
      return `@opencode-ai/sdk@${version.replace(/^[\^~]/, "")}`;
    }
  } catch (error) {
    console.warn(`Failed to read OpenCode SDK version: ${error}`);
  }
  return "@opencode-ai/sdk@unknown";
}

/**
 * Build auth headers for an embedded OpenCode server when server auth is enabled.
 *
 * @returns Headers required by the OpenCode server, or undefined when auth is disabled.
 */
function getOpencodeServerAuthHeaders(): Record<string, string> | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) {
    return undefined;
  }

  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
  };
}

/**
 * Metrics collected during task execution.
 */
interface Metrics {
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * OpenCode SDK agent adapter.
 */
export class OpencodeAgent implements Agent {
  private modelConfig: ModelConfig;
  private agentName: string;

  constructor(modelConfig?: ModelConfig, agentName: string = "opencode") {
    this.modelConfig = modelConfig || DEFAULT_MODEL;
    this.agentName = agentName;
  }

  name(): string {
    return this.agentName;
  }

  /**
   * Execute a task using OpenCode SDK.
   */
  async execute(task: Task, workspace: string): Promise<AgentResult> {
    console.log(
      `Starting OpenCode server for task ${task.id} in workspace: ${workspace}...`,
    );

    // Start embedded OpenCode server for this task
    const server = await createOpencodeServer({
      port: 0, // Auto-assign port
    });
    const client = createOpencodeClient({
      baseUrl: server.url,
      headers: getOpencodeServerAuthHeaders(),
    });

    try {
      return await this.withTimeout(
        this.runTask(task, client, workspace),
        task.timeout,
        `OpenCode execution timed out for ${task.id} after ${task.timeout} seconds`
      );
    } finally {
      // Always cleanup
      console.log(`Closing OpenCode server...`);
      try {
        await server.close();
      } catch (error) {
        console.warn("Warning: Failed to close OpenCode server:", error);
      }
    }
  }

  /**
   * Run the task with OpenCode client.
   */
  private async runTask(
    task: Task,
    client: OpencodeClient,
    workspace: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();

    // Create session in the workspace directory
    console.log(`Creating OpenCode session in workspace: ${workspace}...`);
    const sessionResponse = await client.session.create({
      query: {
        directory: workspace,
      },
    });

    if (!sessionResponse.data) {
      throw new AgentError("Failed to create session: no data returned");
    }

    const sessionId = sessionResponse.data.id;
    console.log(`Session created: ${sessionId}`);

    // Build agent configuration based on task permissions
    const agentType = this.selectAgentType(task);

    try {
      // Send task prompt asynchronously (returns 204 immediately).
      console.log(`Sending prompt to OpenCode...`);
      await client.session.promptAsync({
        path: { id: sessionId },
        query: { directory: workspace },
        body: {
          parts: [
            {
              type: "text",
              text: task.prompt,
            },
          ],
          agent: agentType,
          model: this.modelConfig,
        },
      });
      // Wait for session.idle via SSE, auto-approving any permission prompts.
      console.log(`Waiting for session to complete...`);
      await this.waitForIdle(client, sessionId, workspace, task.timeout);

      const durationSecs = (Date.now() - startTime) / 1000;

      // Get full conversation history and compute metrics from completed messages
      console.log(`Retrieving full conversation history...`);
      const { output: conversationOutput, metrics } =
        await this.getConversationHistoryAndMetrics(client, sessionId, workspace);

      console.log(
        `Task completed: ${metrics.iterations} iterations, ${metrics.inputTokens + metrics.outputTokens} tokens`,
      );
      console.log(
        `Agent output length: ${conversationOutput.length} characters`,
      );

      return {
        success: true, // Will be determined by verification
        output: conversationOutput,
        iterations: metrics.iterations,
        tokensUsed: metrics.inputTokens + metrics.outputTokens,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        cost: metrics.cost,
        durationSecs,
        agentVersion: getOpencodeVersion(),
        modelName: `${this.modelConfig.providerID}/${this.modelConfig.modelID}`,
      };
    } catch (error) {
      throw new AgentError(`OpenCode execution failed: ${error}`);
    }
  }

  /**
   * Enforce a timeout around an async operation.
   */
  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutSecs: number,
    timeoutMessage: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new AgentError(timeoutMessage));
          }, timeoutSecs * 1000);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Subscribe to SSE events and wait until the session is idle.
   * While waiting, auto-approve any permission.updated events so the benchmark
   * never hangs on a permission prompt asking for user confirmation.
   */
  private async waitForIdle(
    client: OpencodeClient,
    sessionId: string,
    workspace: string,
    timeoutSecs: number,
  ): Promise<void> {
    const { stream } = await client.event.subscribe({
      query: { directory: workspace },
    });

    const timer = setTimeout(() => {
      console.warn(`waitForIdle: timed out after ${timeoutSecs}s for session ${sessionId}`);
    }, timeoutSecs * 1000);

    try {
      for await (const raw of stream) {
        // The SSE payload is wrapped: { payload: { type, properties } }
        const ev = (raw as any)?.payload ?? raw as any;
        const type: string = ev?.type ?? "";
        const props = ev?.properties ?? {};

        if (type === "session.idle" && props.sessionID === sessionId) {
          return;
        }

        // Auto-approve permission requests for this session.
        if (type === "permission.updated" && props.sessionID === sessionId) {
          const permId: string = props.id;
          console.log(`Auto-approving permission: ${props.title ?? permId}`);
          try {
            await client.postSessionIdPermissionsPermissionId({
              path: { id: sessionId, permissionID: permId },
              query: { directory: workspace },
              body: { response: "always" },
            });
          } catch (e) {
            console.warn(`Failed to approve permission ${permId}: ${e}`);
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Select appropriate OpenCode agent type based on task category.
   */
  private selectAgentType(task: Task): string {
    // Use 'plan' agent for read-only tasks, 'build' for others
    if (!task.permissions.write && !task.permissions.bash) {
      return "plan";
    }
    return "build";
  }

  /**
   * Recursively collect all session IDs in the tree rooted at sessionId
   * (the root session plus all subagent child sessions).
   */
  private async collectAllSessionIds(
    client: OpencodeClient,
    sessionId: string,
    workspace: string,
  ): Promise<string[]> {
    const ids: string[] = [sessionId];
    try {
      const childrenResponse = await client.session.children({
        path: { id: sessionId },
        query: {
          directory: workspace,
        },
      });
      for (const child of childrenResponse.data ?? []) {
        const childIds = await this.collectAllSessionIds(client, child.id, workspace);
        ids.push(...childIds);
      }
    } catch (error) {
      console.warn(
        `Failed to fetch children for session ${sessionId}: ${error}`,
      );
    }
    return ids;
  }

  /**
   * Get full conversation history and compute metrics from completed session messages.
   * Includes all subagent child sessions so token counts are accurate.
   * Token counts and cost are read from AssistantMessage fields which are only
   * fully populated after the message is complete.
   */
  private async getConversationHistoryAndMetrics(
    client: OpencodeClient,
    sessionId: string,
    workspace: string,
  ): Promise<{ output: string; metrics: Metrics }> {
    const metrics: Metrics = {
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };

    // Collect root session + all subagent child sessions
    const allSessionIds = await this.collectAllSessionIds(client, sessionId, workspace);
    if (allSessionIds.length > 1) {
      console.log(
        `Found ${allSessionIds.length} sessions (1 root + ${allSessionIds.length - 1} subagent)`,
      );
    }

    const conversationParts: string[] = [];

    for (const sid of allSessionIds) {
      try {
        const messagesResponse = await client.session.messages({
          path: { id: sid },
          query: {
            directory: workspace,
          },
        });

        if (!messagesResponse.data) {
          console.warn(`No messages data returned for session ${sid}`);
          continue;
        }

        // For input tokens: each turn re-sends the entire accumulated context, so
        // summing across all turns would count shared context N times. Instead we
        // take only the LAST assistant message's input (including cache fields) as
        // the canonical "peak context size", which is the true unique input cost.
        // This is correct for all providers: GPT, Claude, DeepSeek, etc.
        // For output tokens: every turn produces genuinely new output, so we sum.
        let lastInputTokens = 0;

        const isSubagent = sid !== sessionId;
        for (const message of messagesResponse.data) {
          const info = message.info;
          const role = info?.role || "unknown";
          const parts = message.parts || [];

          if (info?.role === "assistant") {
            metrics.iterations++;
            const tokens = (info as any).tokens;
            // Track the latest assistant message's total input (input + cache.read
            // + cache.write). cache fields are non-zero on Claude; GPT reports
            // cached reads under cache.read too. Taking the max/last avoids
            // double-counting context that grows cumulatively each turn.
            lastInputTokens =
              (tokens?.input || 0) +
              (tokens?.cache?.read || 0) +
              (tokens?.cache?.write || 0);
            metrics.outputTokens += tokens?.output || 0;
            metrics.cost += (info as any).cost || 0;
          }

          // Format each message with role prefix (tag subagent messages)
          const messageParts: string[] = [];
          for (const part of parts) {
            if (part.type === "text" && part.text) {
              messageParts.push(part.text);
            } else if (part.type === "tool") {
              const toolUse = part as any;
              messageParts.push(`[Tool: ${toolUse.tool || "unknown"}]`);
            }
          }

          if (messageParts.length > 0) {
            const prefix = isSubagent
              ? `[SUBAGENT:${sid.slice(0, 8)} ${role.toUpperCase()}]`
              : `[${role.toUpperCase()}]`;
            conversationParts.push(`${prefix}\n${messageParts.join("\n")}`);
          }
        }

        // Add the peak input size for this session (last assistant message only)
        metrics.inputTokens += lastInputTokens;
      } catch (error) {
        console.warn(`Failed to retrieve messages for session ${sid}: ${error}`);
      }
    }

    return { output: conversationParts.join("\n\n"), metrics };
  }
}

/**
 * Build OpenCode agent configuration from task permissions.
 * TODO: This would be used to create custom agent configs, but for now
 * we use the built-in 'build' and 'plan' agents.
 */
export function buildAgentConfig(task: Task): any {
  const config: any = {
    tools: {},
    permission: {},
  };

  // Map tools
  if (task.permissions.read) {
    config.tools.Read = true;
    config.tools.Glob = true;
    config.tools.Grep = true;
  }
  if (task.permissions.write) {
    config.tools.Write = true;
    config.tools.Edit = true;
  }
  if (task.permissions.bash) {
    config.tools.Bash = true;
  }
  if (task.permissions.web_fetch) {
    config.tools.WebFetch = true;
    config.tools.WebSearch = true;
  }

  // Map permission mode
  if (
    task.permissions.mode === "dontAsk" ||
    task.permissions.mode === "bypassPermissions"
  ) {
    config.permission.edit = "allow";
    config.permission.bash = "allow";
  } else {
    config.permission.edit = "ask";
    config.permission.bash = "ask";
  }

  // Map max_iterations
  if (task.max_iterations) {
    config.maxSteps = task.max_iterations;
  }

  return config;
}
