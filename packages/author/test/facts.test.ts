import { assertNoConflict, FactConflictError } from '../src/index';

describe('assertNoConflict', () => {
  it.each(['345mm', '345 mm', '345 millimetres'])('refuses "%s" in every spelling', (conflict) => {
    for (const text of ['345mm', '345 mm', '345 millimetres', 'Gauge: 345 Millimeters max']) {
      expect(() => assertNoConflict(text, [conflict])).toThrow(FactConflictError);
    }
  });

  it('lets other numbers through', () => {
    expect(() => assertNoConflict('325 mm', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('1345 mm', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('3450 mm', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('345 kg', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('Headlap', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('345 mm', [])).not.toThrow();
  });

  it('treats a bare number as a match for the same number with a unit, both ways', () => {
    expect(() => assertNoConflict('345', ['345 mm'])).toThrow(FactConflictError);
    expect(() => assertNoConflict('345 mm', ['345'])).toThrow(FactConflictError);
  });

  it('reads decimals and thousands separators as numbers', () => {
    expect(() => assertNoConflict('345.0 mm', ['345mm'])).toThrow(FactConflictError);
    expect(() => assertNoConflict('1,200 mm', ['1200 mm'])).toThrow(FactConflictError);
    expect(() => assertNoConflict('34.5 mm', ['345 mm'])).not.toThrow();
    expect(() => assertNoConflict('22.5 degrees', ['22.5°'])).toThrow(FactConflictError);
  });

  it('names the figure and the text in the error', () => {
    let caught: unknown;
    try {
      assertNoConflict('Gauge 345 mm', ['100 mm', '345 millimetres']);
    } catch (error) {
      caught = error;
    }
    const error = caught as FactConflictError;
    expect(error.name).toBe('FactConflictError');
    expect(error.text).toBe('Gauge 345 mm');
    expect(error.conflict).toBe('345 millimetres');
    expect(error.message).toContain('"Gauge 345 mm"');
    expect(error.message).toContain('345 millimetres');
  });

  it('refuses a conflict entry with no figure in it', () => {
    expect(() => assertNoConflict('345 mm', ['the gauge'])).toThrow(
      /conflict "the gauge" has no number/
    );
  });
});
