import { buildCommand } from './build';
import { checkCommand } from './check';
import { devCommand } from './dev';
import { exportCommand } from './export';
import { qaCommand } from './qa';
import { voiceCommand } from './voice';

export const commands = [
  buildCommand,
  checkCommand,
  voiceCommand,
  qaCommand,
  devCommand,
  exportCommand,
];
