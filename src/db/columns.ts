import { customType } from 'drizzle-orm/pg-core';

/**
 * citext — case-insensitive text. Maps to the `citext` Postgres extension.
 * Required by 0001_super_admins (email, recovery_email). Drizzle has no
 * built-in for this, so we use a customType that compiles down to `citext`.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * inet[] — IP-address array, used by super_admins.allowed_ips (spec 2.9.7)
 * and outgoing_webhook_subscriptions.allowed_ips (spec 31.8).
 * Stored as a Postgres array of inet; surfaced as `string[]` in TS.
 */
export const inetArray = customType<{ data: string[]; driverData: string }>({
  dataType() {
    return 'inet[]';
  },
  toDriver(value: string[]): string {
    if (value.length === 0) return '{}';
    return `{${value.map((ip) => `"${ip}"`).join(',')}}`;
  },
  fromDriver(value: string): string[] {
    if (typeof value !== 'string') return [];
    const inner = value.replace(/^\{|\}$/g, '');
    if (inner.length === 0) return [];
    return inner.split(',').map((ip) => ip.replace(/^"|"$/g, ''));
  },
});
