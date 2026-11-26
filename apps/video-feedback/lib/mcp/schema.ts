import type { ObjectSchema, PropSchema, SchemaType } from './types';

// Checks tool arguments against the small JSON Schema subset the tools use. The messages are
// written for the model that made the call, so it can fix the call and try again.

function typeOf(value: unknown): SchemaType | 'null' | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'object') {
    return typeof value as SchemaType;
  }
  return 'other';
}

function matchesType(value: unknown, type: SchemaType): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function checkProp(name: string, value: unknown, schema: PropSchema): string | null {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((t) => matchesType(value, t))) {
    return `"${name}" must be ${types.join(' or ')}.`;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    return `"${name}" must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}.`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `"${name}" must be at least ${schema.minimum}.`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `"${name}" must be at most ${schema.maximum}.`;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `"${name}" must be at least ${schema.minLength} characters.`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `"${name}" must be at most ${schema.maxLength} characters.`;
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      return `"${name}" is not in the right form.`;
    }
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `"${name}" may have at most ${schema.maxItems} items.`;
    }
    if (schema.items) {
      for (const [i, item] of value.entries()) {
        const problem = checkProp(`${name}[${i}]`, item, schema.items);
        if (problem) return problem;
      }
    }
  }
  return null;
}

/** Null when the arguments fit the schema, otherwise what is wrong with them. */
export function checkArgs(args: unknown, schema: ObjectSchema): string | null {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'The arguments must be an object.';
  const record = args as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) return `"${key}" is required.`;
  }
  for (const [key, value] of Object.entries(record)) {
    const prop = schema.properties[key];
    if (prop === undefined) {
      if (schema.additionalProperties === false) {
        const known = Object.keys(schema.properties);
        return `Unknown argument "${key}". The arguments are: ${known.join(', ') || 'none'}.`;
      }
      continue;
    }
    if (value === undefined) continue;
    const problem = checkProp(key, value, prop);
    if (problem) return problem;
  }
  return null;
}
