/**
 * OpenCode SDK agent adapter.
 */

import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
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
 * Metrics collected during task execution.
 */
interface Metrics {
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  output: string[];
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
    const { server, client } = await createOpencode({
      port: 0, // Auto-assign port
    });

    try {
      return await this.runTask(task, client, workspace);
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

    const metrics: Metrics = {
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      output: [],
    };

    // Build agent configuration based on task permissions
    const agentType = this.selectAgentType(task);

    // Start event stream subscription for metrics collection
    const eventPromise = this.captureMetrics(client, workspace, metrics);

    try {
      // Send task prompt
      console.log(`Sending prompt to OpenCode...`);
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [
            {
              type: "text",
              text: task.prompt,
            },
          ],
          agent: agentType,
          model: this.modelConfig,
          // Note: Tool permissions are controlled at the agent level in OpenCode
          // We would need to create custom agents for different permission sets
        },
      });

      // Wait for session to complete (event stream will resolve)
      await eventPromise;

      const durationSecs = (Date.now() - startTime) / 1000;

      // Get full conversation history after completion
      console.log(`Retrieving full conversation history...`);
      const conversationOutput = await this.getConversationHistory(client, sessionId);

      console.log(
        `Task completed: ${metrics.iterations} iterations, ${metrics.inputTokens + metrics.outputTokens} tokens`,
      );
      console.log(`Agent output length: ${conversationOutput.length} characters`);

      return {
        success: true, // Will be determined by verification
        output: conversationOutput,
        iterations: metrics.iterations,
        tokensUsed: metrics.inputTokens + metrics.outputTokens,
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
   * Subscribe to event stream and capture metrics.
   */
  private async captureMetrics(
    client: OpencodeClient,
    _workspace: string,
    metrics: Metrics,
  ): Promise<void> {
    console.log(`Subscribing to event stream...`);

    try {
      // Subscribe to SSE event stream
      const eventStream = await client.event.subscribe({});

      for await (const event of eventStream.stream) {
        // Handle different event types
        switch (event.type) {
          case "message.updated":
            await this.handleMessageUpdate(event, metrics);
            break;

          case "session.idle":
            console.log(`Session idle - task completed`);
            return; // Session completed

          case "session.error":
            const errorMsg =
              (event.properties as any)?.message || "Unknown error";
            throw new AgentError(`Session error: ${errorMsg}`);

          default:
            // Ignore other event types
            break;
        }
      }
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      // If stream ends normally, that's fine
      console.log(`Event stream ended`);
    }
  }

  /**
   * Handle message.updated event.
   */
  private async handleMessageUpdate(
    event: any,
    metrics: Metrics,
  ): Promise<void> {
    const msg = event.properties?.info;
    const parts = event.properties?.parts || [];

    if (msg && msg.role === "assistant") {
      // Count this as an iteration
      metrics.iterations++;

      // Accumulate tokens
      if (msg.tokens) {
        metrics.inputTokens += msg.tokens.input || 0;
        metrics.outputTokens += msg.tokens.output || 0;
      }

      // Accumulate cost
      if (msg.cost) {
        metrics.cost += msg.cost;
      }

      // Collect text output
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          metrics.output.push(part.text);
        }
      }

      console.log(
        `  Iteration ${metrics.iterations}: ${metrics.inputTokens + metrics.outputTokens} tokens`,
      );
    }
  }

  /**
   * Get full conversation history from session.
   */
  private async getConversationHistory(
    client: OpencodeClient,
    sessionId: string,
  ): Promise<string> {
    try {
      const messagesResponse = await client.session.messages({
        path: { id: sessionId },
      });

      if (!messagesResponse.data) {
        console.warn("No messages data returned from session");
        return "";
      }

      const messages = messagesResponse.data;
      const conversationParts: string[] = [];

      for (const message of messages) {
        const role = message.info?.role || "unknown";
        const parts = message.parts || [];

        // Format each message with role prefix
        const messageParts: string[] = [];
        for (const part of parts) {
          if (part.type === "text" && part.text) {
            messageParts.push(part.text);
          } else if (part.type === "tool") {
            // Include tool use information
            const toolUse = part as any;
            messageParts.push(
              `[Tool: ${toolUse.name || "unknown"}]`,
            );
          }
        }

        if (messageParts.length > 0) {
          conversationParts.push(`[${role.toUpperCase()}]\n${messageParts.join("\n")}`);
        }
      }

      return conversationParts.join("\n\n");
    } catch (error) {
      console.warn(`Failed to retrieve conversation history: ${error}`);
      return "";
    }
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
