import { program } from 'commander';
import { commands } from './commands/index';

program.name('talkie').description('Author, build and check Talkie films');
for (const command of commands) {
  program.addCommand(command);
}

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
