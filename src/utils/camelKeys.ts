const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// Recursively converts snake_case object keys to camelCase (e.g. raw SQL rows). Dates and primitives pass through.
export const camelKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(camelKeys);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [toCamel(k), camelKeys(v)]));
};
