import { createHash } from 'node:crypto';
export const VERSION = 'sovmem-mock/v1';
export const FORMAT = 'sovmem-mock-store/v1';
export const ASOF = '2026-09-15T00:00:00Z';
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function check(value, message = 'Invalid request') { if (!value) fail('request.invalid', message); }
export function id(value) { check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value), 'Expected an opaque mock ID'); return value; }
export function integer(value, fallback, min = 1, max = 100) { const n = value ?? fallback; check(Number.isInteger(n) && n >= min && n <= max, `Expected integer ${min}..${max}`); return n; }
export function text(value, name, max = 32000) { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${name}`); return value; }
export function digest(value) { return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }
export function stable(v) { if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`; if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`; return JSON.stringify(v); }
export function instant(value = ASOF) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'Expected timestamp with offset');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  check(month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(), 'Invalid calendar date');
  return value;
}
export function owner(role) { if (role !== 'owner') fail('authority.owner_required', 'Use the separate simulated owner surface; no real signing occurs'); }
