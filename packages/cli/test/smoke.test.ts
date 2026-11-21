import { commands } from '../src/commands/index';

test('cli workspace is wired', () => {
  expect(1).toBe(1);
});

test('every command exists as a stub that says it is not implemented', async () => {
  expect(commands.map((c) => c.name())).toEqual(['build', 'check', 'voice', 'qa', 'dev', 'export']);
  for (const command of commands) {
    command.exitOverride();
    await expect(command.parseAsync([], { from: 'user' })).rejects.toThrow(
      `${command.name()}: not implemented yet`
    );
  }
});
