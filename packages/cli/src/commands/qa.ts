import { Command, Option } from 'commander';
import { formatQa } from '../qa/report';
import { runQa } from '../qa/run';

export const qaCommand = new Command('qa')
  .description('Build a film project and run the quality gates on it')
  .argument('[dir]', 'the film project folder', '.')
  .addOption(
    new Option('--opus <container>', 'container of the Opus track')
      .choices(['webm', 'ogg'])
      .default('webm')
  )
  .action(async (dir: string, options: { opus: 'webm' | 'ogg' }) => {
    const { gates, ok } = await runQa(dir, { opus: options.opus });
    process.stdout.write(formatQa(gates));
    if (!ok) {
      const failed = gates.filter((gate) => gate.status === 'FAIL').map((gate) => gate.name);
      const count = failed.length === 1 ? '1 gate' : `${failed.length} gates`;
      // bin.ts prints the message and exits 1
      throw new Error(`qa: ${count} failed: ${failed.join(', ')}`);
    }
    process.stdout.write('qa: all gates passed\n');
  });
