import { Command } from 'commander';
import { checkFilm } from '../check';

export const checkCommand = new Command('check')
  .description('Validate a built film')
  .argument('<film>', 'a film folder or a .lottie file')
  .action(async (film: string) => {
    const problems = await checkFilm(film);
    if (problems.length > 0) {
      const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
      // bin.ts prints the message and exits 1
      throw new Error(`${film}: ${count}\n${problems.map((p) => `  ${p}`).join('\n')}`);
    }
    process.stdout.write(`${film}: OK\n`);
  });
