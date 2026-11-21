import { Command } from 'commander';

export const buildCommand = new Command('build')
  .description('Build a film project into dist/film and dist/film.lottie')
  .action(() => {
    throw new Error('build: not implemented yet');
  });
