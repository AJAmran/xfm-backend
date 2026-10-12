-- Adds the document-processing tier to the role enum.
--
-- DOCUMENT_OFFICER  department heads who work documents (submit, approve,
--                   sign) and nothing else. Same surface as MANAGER.
--
-- Widening an ENUM is backward compatible: every existing row keeps its value.
-- On MySQL/MariaDB this rebuilds the column, so run it in a maintenance window
-- on a large `users` table.
--
-- The eight department-head accounts are re-roled by a focused data script,
-- not by this migration, so that no row is silently re-roled by a schema change.

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM(
    'SUPER_ADMIN',
    'ADMIN',
    'DIRECTOR',
    'MANAGER',
    'DOCUMENT_OFFICER',
    'BRANCH_MANAGER',
    'COO',
    'MD'
  ) NOT NULL;
