-- Approver signature images (e.g. COO stamp on approval). Nullable, additive only.
ALTER TABLE `users` ADD COLUMN `signature_url` VARCHAR(191) NULL;
ALTER TABLE `manager_reports` ADD COLUMN `approved_signature` VARCHAR(191) NULL;
ALTER TABLE `guest_discount_logs` ADD COLUMN `approved_signature` VARCHAR(191) NULL;
ALTER TABLE `guest_entertainment_logs` ADD COLUMN `approved_signature` VARCHAR(191) NULL;
