/** On-screen text states a figure that the sources disagree about. */
export class FactConflictError extends Error {
  constructor(
    public readonly text: string,
    /** The entry of the conflict list that matched, as it was written. */
    public readonly conflict: string,
    message: string
  ) {
    super(message);
    this.name = 'FactConflictError';
  }
}

interface Figure {
  value: number;
  /** A canonical unit, or '' when the figure has none we know. */
  unit: string;
}

const UNIT_SPELLINGS: Record<string, string[]> = {
  mm: ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'],
  cm: ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters'],
  m: ['m', 'metre', 'metres', 'meter', 'meters'],
  km: ['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers'],
  in: ['in', 'inch', 'inches', '"'],
  ft: ['ft', 'foot', 'feet'],
  g: ['g', 'gram', 'grams', 'gramme', 'grammes'],
  kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes'],
  deg: ['°', 'deg', 'degree', 'degrees'],
  '%': ['%', 'percent', 'per cent'],
};
const UNITS = new Map<string, string>();
for (const unit of Object.keys(UNIT_SPELLINGS)) {
  for (const spelling of UNIT_SPELLINGS[unit]) {
    UNITS.set(spelling, unit);
  }
}

/** A number, then whatever word or sign follows it. A digit run is never split. */
const FIGURE = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(per cent|[a-z]+|[°%"])?/g;

/** Every figure in a text, with digits and units in one canonical form. */
function figures(text: string): Figure[] {
  const out: Figure[] = [];
  for (const match of text.toLowerCase().matchAll(FIGURE)) {
    const value = Number(match[1].replaceAll(',', '') + (match[2] ?? ''));
    out.push({ value, unit: UNITS.get(match[3] ?? '') ?? '' });
  }
  return out;
}

const show = ({ value, unit }: Figure) => (unit ? `${value} ${unit}` : `${value}`);

/**
 * The fail-closed number gate. Throws if the text states any figure on the conflict list,
 * however it is spelt: "345mm", "345 mm" and "345 millimetres" are the same figure. A figure
 * with no unit matches the same number with any unit, so a bare "345" cannot slip through.
 */
export function assertNoConflict(text: string, conflicts: string[]): void {
  const stated = figures(text);
  for (const conflict of conflicts) {
    const refused = figures(conflict);
    if (refused.length === 0) {
      throw new Error(`conflict "${conflict}" has no number in it, write it like "345 mm"`);
    }
    for (const bad of refused) {
      const hit = stated.find(
        (f) => f.value === bad.value && (f.unit === bad.unit || f.unit === '' || bad.unit === '')
      );
      if (hit) {
        throw new FactConflictError(
          text,
          conflict,
          `"${text}" states ${show(hit)}, and "${conflict}" is listed as a figure the sources ` +
            'disagree about. Take the figure out, or settle it and remove it from conflicts.'
        );
      }
    }
  }
}
