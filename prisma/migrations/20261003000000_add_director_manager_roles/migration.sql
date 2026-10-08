-- Adds the corporate management tier to the role enum.
--
-- SUPER_ADMIN  system administration (unchanged)
-- ADMIN        user + branch administration (unchanged)
-- DIRECTOR     corporate business leadership, global, no admin rights (new)
-- MANAGER      corporate department manager / head, global (new)
-- BRANCH_MANAGER branch-scoped operations (unchanged)
-- COO          general manager tier (unchanged)
-- MD           final authority, read-only in the UI (unchanged)
--
-- Widening an ENUM is backward compatible: every existing row keeps its value.
-- On MySQL/MariaDB this rebuilds the column, so run it in a maintenance window
-- on a large `users` table.
--
-- Two seeded placeholder accounts are promoted by the accompanying import
-- (prisma/import-corporate-users.ts), not by this migration, so that no row is
-- silently re-roled by a schema change.

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM(
    'SUPER_ADMIN',
    'ADMIN',
    'DIRECTOR',
    'MANAGER',
    'BRANCH_MANAGER',
    'COO',
    'MD'
  ) NOT NULL;
