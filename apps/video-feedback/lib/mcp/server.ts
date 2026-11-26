import { checkArgs } from './schema';
import type { Prompt, Tool, ToolContext, ToolResult } from './types';
import { ToolError } from './types';

// The MCP methods this server answers, as plain JSON-RPC: no SDK, no sessions. Every request
// stands alone, so any app slot can answer it and a deploy drops nothing but calls in flight.

export const SERVER_NAME = 'video-feedback';
export const SERVER_VERSION = '1.0.0';

/** Newest first. A client asking for one of these gets it; anything else gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };

export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export interface McpServer {
  tools: readonly Tool[];
  prompts: readonly Prompt[];
  instructions: string;
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** True for a message that is a request (it has an id and a method), not a notification. */
export function isRequest(msg: unknown): msg is JsonRpcRequest & { id: string | number } {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.method === 'string' &&
    (typeof m.id === 'string' || (typeof m.id === 'number' && Number.isFinite(m.id)))
  );
}

/** The tool a `tools/call` request names, if it is one of ours. */
export function toolFor(server: McpServer, msg: JsonRpcRequest): Tool | undefined {
  if (msg.method !== 'tools/call') return undefined;
  const name = msg.params?.name;
  return server.tools.find((t) => t.name === name);
}

async function callTool(
  server: McpServer,
  params: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | { error: string }> {
  const tool = server.tools.find((t) => t.name === params.name);
  if (!tool) return { error: `Unknown tool: ${String(params.name)}` };
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  // A bad argument is the model's to fix, so it comes back as a tool result, not a protocol error.
  const problem = checkArgs(args, tool.inputSchema);
  if (problem) return { content: [{ type: 'text', text: problem }], isError: true };
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    if (err instanceof ToolError) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
    console.error(`[mcp] ${tool.name} failed:`, err);
    return {
      content: [
        { type: 'text', text: `${tool.name} failed on the server. Try again, or tell Tim.` },
      ],
      isError: true,
    };
  }
}

function listTools(server: McpServer) {
  return {
    tools: server.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, ...t.annotations },
    })),
  };
}

function getPrompt(server: McpServer, params: Record<string, unknown>) {
  const prompt = server.prompts.find((p) => p.name === params.name);
  if (!prompt) return null;
  const raw = (params.arguments ?? {}) as Record<string, unknown>;
  const args: Record<string, string> = {};
  for (const a of prompt.arguments) {
    const v = raw[a.name];
    if (typeof v === 'string' && v.trim() !== '') args[a.name] = v.trim();
    else if (a.required) return { missing: a.name };
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }],
  };
}

/** Answers one request. Notifications never reach here: they get no answer. */
export async function handleRequest(
  server: McpServer,
  msg: JsonRpcRequest & { id: string | number },
  ctx: ToolContext
): Promise<JsonRpcResponse> {
  const { id } = msg;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: SERVER_NAME,
            title: 'Video feedback',
            version: SERVER_VERSION,
          },
          instructions: server.instructions,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: listTools(server) };
    case 'tools/call': {
      const result = await callTool(server, params, ctx);
      if ('error' in result) return rpcError(id, ERRORS.invalidParams, result.error);
      return { jsonrpc: '2.0', id, result };
    }
    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: server.prompts.map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description,
            arguments: p.arguments,
          })),
        },
      };
    case 'prompts/get': {
      const got = getPrompt(server, params);
      if (got === null) return rpcError(id, ERRORS.invalidParams, `Unknown prompt: ${params.name}`);
      if ('missing' in got) {
        return rpcError(id, ERRORS.invalidParams, `The prompt needs "${got.missing}".`);
      }
      return { jsonrpc: '2.0', id, result: got };
    }
    // Nothing is offered as a resource: the tools carry it all. Answering keeps clients happy.
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'resources/templates/list':
      return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
    case 'logging/setLevel':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return rpcError(id, ERRORS.methodNotFound, `Method not found: ${msg.method}`);
  }
}
