import { mcpMethodNotAllowed, mcpPost } from './http';
import { PROTOCOL_VERSIONS, type McpServer } from './server';
import { ok, type Tool, textContent, ToolError } from './types';

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Says it back.',
  inputSchema: {
    type: 'object',
    properties: {
      say: { type: 'string', maxLength: 10 },
      times: { type: 'integer', minimum: 1, maximum: 3 },
    },
    required: ['say'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  run: async (args) => ok(textContent(String(args.say).repeat(Number(args.times ?? 1)))),
};

const refuse: Tool = {
  name: 'refuse',
  title: 'Refuse',
  description: 'Always refuses.',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new ToolError('No, and here is why.');
  },
};

const crash: Tool = {
  name: 'crash',
  title: 'Crash',
  description: 'Fails badly.',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new Error('secret internals');
  },
};

let release: () => void = () => {};
let sawAbort = false;
const slow: Tool = {
  name: 'slow',
  title: 'Slow',
  description: 'Waits until released.',
  inputSchema: { type: 'object', properties: {} },
  longRunning: true,
  run: async (_args, ctx) => {
    ctx.progress('still waiting');
    await new Promise<void>((resolve) => {
      release = resolve;
      ctx.signal.addEventListener('abort', () => {
        sawAbort = true;
        resolve();
      });
    });
    return ok(textContent('done'));
  },
};

const server: McpServer = {
  tools: [echo, refuse, crash, slow],
  prompts: [
    {
      name: 'hello',
      title: 'Hello',
      description: 'Greets.',
      arguments: [{ name: 'who', description: 'Who.', required: true }],
      text: ({ who }) => `Say hello to ${who}.`,
    },
  ],
  instructions: 'Be nice.',
};

function post(body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return mcpPost(
    new Request('http://x/api/admin/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal,
    }),
    server,
    null,
    { keepAliveMs: 20 }
  );
}

const call = (id: number, name: string, args: unknown = {}, extra: object = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args, ...extra },
});

describe('MCP over HTTP', () => {
  it('initialises with the version asked for, the capabilities and the instructions', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('video-feedback');
    expect(body.result.instructions).toBe('Be nice.');
  });

  it('answers an unknown protocol version with the newest it knows', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect((await res.json()).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it('accepts notifications with 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('lists tools with their schemas and annotations', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    const tool = body.result.tools.find((t: { name: string }) => t.name === 'echo');
    expect(tool.inputSchema.required).toEqual(['say']);
    expect(tool.annotations).toMatchObject({ title: 'Echo', readOnlyHint: true });
  });

  it('calls a tool', async () => {
    const body = await (await post(call(3, 'echo', { say: 'hi', times: 2 }))).json();
    expect(body.result).toEqual({ content: [{ type: 'text', text: 'hihi' }] });
  });

  it('gives bad arguments back to the model as a tool error it can fix', async () => {
    const cases: [unknown, RegExp][] = [
      [{}, /"say" is required/],
      [{ say: 3 }, /"say" must be string/],
      [{ say: 'x', times: 9 }, /at most 3/],
      [{ say: 'x', loud: true }, /Unknown argument "loud"/],
      [{ say: 'much too long here' }, /at most 10 characters/],
    ];
    for (const [args, message] of cases) {
      const body = await (await post(call(4, 'echo', args))).json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toMatch(message);
    }
  });

  it('shows a ToolError message, and hides the message of anything else', async () => {
    const refused = await (await post(call(5, 'refuse'))).json();
    expect(refused.result).toMatchObject({
      isError: true,
      content: [{ text: 'No, and here is why.' }],
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crashed = await (await post(call(6, 'crash'))).json();
    spy.mockRestore();
    expect(crashed.result.isError).toBe(true);
    expect(JSON.stringify(crashed)).not.toContain('secret internals');
  });

  it('says an unknown tool or method is unknown', async () => {
    expect((await (await post(call(7, 'nope'))).json()).error.code).toBe(-32602);
    const body = await (await post({ jsonrpc: '2.0', id: 8, method: 'sampling/x' })).json();
    expect(body.error.code).toBe(-32601);
  });

  it('refuses what is not JSON-RPC', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post('"text"')).status).toBe(400);
    expect((await post({ hello: 1 })).status).toBe(400);
  });

  it('refuses a body that is too large', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { x: 'y'.repeat(300_000) },
    });
    expect(res.status).toBe(413);
  });

  it('answers a batch together', async () => {
    const body = await (
      await post([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ])
    ).json();
    expect(body.map((r: { id: number }) => r.id)).toEqual([1, 2]);
  });

  it('expands a prompt and asks for a missing argument', async () => {
    const list = await (await post({ jsonrpc: '2.0', id: 1, method: 'prompts/list' })).json();
    expect(list.result.prompts[0].name).toBe('hello');
    const got = await (
      await post({
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/get',
        params: { name: 'hello', arguments: { who: 'Edward' } },
      })
    ).json();
    expect(got.result.messages[0].content.text).toBe('Say hello to Edward.');
    const missing = await (
      await post({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'hello' } })
    ).json();
    expect(missing.error.message).toMatch(/who/);
  });

  it('answers a long tool as an event stream: open at once, keep-alives, progress, then the result', async () => {
    const res = await post(call(9, 'slow', {}, { _meta: { progressToken: 'p1' } }));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-transform');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async () => {
      const { value, done } = await reader.read();
      if (!done) text += decoder.decode(value);
      return done;
    };
    await read();
    expect(text).toContain(': waiting');
    while (!text.includes(': keep-alive')) await read();
    expect(text).toContain('"method":"notifications/progress"');
    expect(text).toContain('"progressToken":"p1"');
    release();
    while (!(await read())) {}
    const last = text.trim().split('\n\n').at(-1) ?? '';
    expect(last.startsWith('event: message\ndata: ')).toBe(true);
    const message = JSON.parse(last.slice('event: message\ndata: '.length));
    expect(message).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: { content: [{ type: 'text', text: 'done' }] },
    });
  });

  it('answers a long tool as JSON for a client that takes no stream', async () => {
    const pending = post(call(10, 'slow'), { Accept: 'application/json' });
    await new Promise((r) => setTimeout(r, 10));
    release();
    const res = await pending;
    expect(res.headers.get('content-type')).toBe('application/json');
    expect((await res.json()).result.content[0].text).toBe('done');
  });

  it('stops a long tool when the client goes away', async () => {
    sawAbort = false;
    const controller = new AbortController();
    const res = await post(call(11, 'slow'), {}, controller.signal);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(sawAbort).toBe(true);
  });

  it('opens no stream on GET', async () => {
    const res = mcpMethodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
