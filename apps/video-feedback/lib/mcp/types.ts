import type { AccessIdentity } from '@/lib/auth/access';

// The shapes every MCP tool is written against. The protocol (JSON-RPC over HTTP) lives in
// server.ts and http.ts; a tool only sees checked arguments and a context, and returns content.

/** The JSON Schema subset tool arguments are checked against (see schema.ts). */
export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface PropSchema {
  type: SchemaType | SchemaType[];
  description?: string;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PropSchema;
  maxItems?: number;
  default?: unknown;
}

export interface ObjectSchema {
  type: 'object';
  properties: Record<string, PropSchema>;
  required?: readonly string[];
  additionalProperties?: false;
}

export type Content =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export interface ToolContext {
  /** Who is calling: null when admin auth is off (development and tests). */
  identity: AccessIdentity | null;
  /** The public origin, no trailing slash: https://video-feedback.tdobson.net */
  baseUrl: string;
  /** Aborted when the client goes away. A tool that waits must stop then. */
  signal: AbortSignal;
  /** A line of progress for a long call. Sent only when the client asked for progress. */
  progress: (message: string) => void;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  /** What the tool is for and when to use it, written for a model. */
  description: string;
  inputSchema: ObjectSchema;
  annotations?: ToolAnnotations;
  /** Can take minutes: answered as an event stream (with keep-alives) when the client takes one. */
  longRunning?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** The user message the prompt expands to. */
  text(args: Record<string, string>): string;
}

/** A failure the agent can act on: its message is shown to the model as the tool's result. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export const textContent = (text: string): Content => ({ type: 'text', text });

/** Pretty JSON as a text block: models read it well, and it stays exact. */
export const jsonContent = (value: unknown): Content => ({
  type: 'text',
  text: JSON.stringify(value, null, 2),
});

export const imageContent = (data: Buffer, mimeType: string): Content => ({
  type: 'image',
  data: data.toString('base64'),
  mimeType,
});

export const ok = (...content: Content[]): ToolResult => ({ content });
