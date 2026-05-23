/**
 * Schema barrel. Add each table file here as it lands.
 * Order does not matter at runtime; FK ordering is enforced by the
 * hand-written migration files in `supabase/migrations/`.
 */
export * from './super-admins.js';
export * from './super-admin-role-permissions.js';
export * from './platform-settings.js';
export * from './platform-theme-config.js';
