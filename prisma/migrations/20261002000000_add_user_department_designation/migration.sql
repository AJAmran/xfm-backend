-- Corporate org profile for users.
--
-- `department` and `designation` are free-text rather than enums so the org can
-- add or rename a department or a job title without a schema migration. Access
-- control remains driven exclusively by the `role` column.
--
-- Purely additive: two nullable columns plus one index. No existing row is
-- modified, moved or deleted.

ALTER TABLE `users` ADD COLUMN `department` VARCHAR(191) NULL;
ALTER TABLE `users` ADD COLUMN `designation` VARCHAR(191) NULL;

-- Supports department-scoped lookups in the approver directory and any future
-- department-filtered reporting.
CREATE INDEX `users_department_idx` ON `users` (`department`);

-- Director/manager listings are always filtered by role and sorted by name.
CREATE INDEX `users_role_designation_idx` ON `users` (`role`, `designation`);
