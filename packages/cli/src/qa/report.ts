import type { Gate } from './gates';

/** One line for each gate, with its details indented under it. */
export function formatQa(gates: Gate[]): string {
  return gates
    .map(
      (gate) =>
        `${gate.status}  ${gate.name}\n${gate.details.map((line) => `      ${line}\n`).join('')}`
    )
    .join('');
}
