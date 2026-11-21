import { commands } from '../src/commands/index';

test('cli workspace is wired', () => {
  expect(1).toBe(1);
});

test('every command exists, and those not written yet say so', async () => {
  expect(commands.map((c) => c.name())).toEqual(['build', 'check', 'voice', 'qa', 'dev', 'export']);
  const written = ['build', 'check'];
  for (const command of commands.filter((c) => !written.includes(c.name()))) {
    command.exitOverride();
    await expect(command.parseAsync([], { from: 'user' })).rejects.toThrow(
      `${command.name()}: not implemented yet`
    );
  }
});
