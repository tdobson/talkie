import { INSTRUCTIONS } from './instructions';
import { prompts } from './prompts';
import type { McpServer } from './server';
import { publishTools } from './tools/publish';
import { readTools } from './tools/read';
import { watchTools } from './tools/watch';

/** The MCP server agents reach at /api/admin/mcp. */
export const mcpServer: McpServer = {
  tools: [...readTools, ...watchTools, ...publishTools],
  prompts,
  instructions: INSTRUCTIONS,
};
