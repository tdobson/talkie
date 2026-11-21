import { Command, Option } from 'commander';
import { buildFilm } from '../build';

export const buildCommand = new Command('build')
  .description('Build a film project into dist/film and dist/film.lottie')
  .argument('[dir]', 'the film project folder', '.')
  .addOption(
    new Option('--opus <container>', 'container of the Opus track')
      .choices(['webm', 'ogg'])
      .default('webm')
  )
  .action(async (dir: string, options: { opus: 'webm' | 'ogg' }) => {
    const { film, outDir, lottie, rebuilt } = await buildFilm(dir, { opus: options.opus });
    const scenes = film.scenes.length === 1 ? '1 scene' : `${film.scenes.length} scenes`;
    process.stdout.write(
      `Built ${film.title}: ${scenes} (${rebuilt.length} rebuilt), ${film.duration} s\n  ${outDir}\n  ${lottie}\n`
    );
  });
