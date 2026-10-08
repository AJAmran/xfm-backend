-- Dynamic multi-level document approval & e-signature module.
--
-- Creates the document/version/file/workflow/approval/signature/audit chain.
-- All statements are additive and idempotent-safe on a fresh database; existing
-- rows in `users`, `branches` and `notifications` are untouched.

-- ─── New ENUM types ─────────────────────────────────────────────────────────────
CREATE TABLE `document_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `default_sla_hours` INT NOT NULL DEFAULT 48,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `is_deleted` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `document_types_code_key`(`code`),
  INDEX `document_types_isDeleted_isActive_idx`(`is_deleted`, `is_active`),
  INDEX `document_types_sortOrder_idx`(`sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `documents` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `document_number` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `document_type_id` INT NOT NULL,
  `branch_id` INT NULL,
  `created_by_user_id` INT NOT NULL,
  `status` ENUM('DRAFT','SUBMITTED','PENDING_APPROVAL','IN_REVIEW','RETURNED_FOR_REVISION','REJECTED','APPROVED','CANCELLED','EXPIRED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `current_version` INT NOT NULL DEFAULT 1,
  `reference_amount` DECIMAL(14,2) NULL,
  `submitted_at` DATETIME(3) NULL,
  `approved_at` DATETIME(3) NULL,
  `archived_at` DATETIME(3) NULL,
  `is_locked` BOOLEAN NOT NULL DEFAULT FALSE,
  `is_deleted` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `documents_document_number_key`(`document_number`),
  INDEX `documents_status_idx`(`status`),
  INDEX `documents_isDeleted_status_idx`(`is_deleted`, `status`),
  INDEX `documents_createdByUserId_status_idx`(`created_by_user_id`, `status`),
  INDEX `documents_branchId_status_idx`(`branch_id`, `status`),
  INDEX `documents_documentTypeId_status_idx`(`document_type_id`, `status`),
  INDEX `documents_createdAt_idx`(`created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `documents_documentTypeId_fkey` FOREIGN KEY (`document_type_id`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `documents_branchId_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `documents_createdByUserId_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `document_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `document_id` INT NOT NULL,
  `version_number` INT NOT NULL,
  `change_summary` TEXT NULL,
  `notes` TEXT NULL,
  `page_count` INT NULL,
  `created_by_user_id` INT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `document_versions_documentId_versionNumber_key`(`document_id`, `version_number`),
  INDEX `document_versions_documentId_versionNumber_idx`(`document_id`, `version_number`),
  PRIMARY KEY (`id`),
  CONSTRAINT `document_versions_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `document_versions_createdByUserId_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `document_files` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `document_id` INT NOT NULL,
  `version_id` INT NOT NULL,
  `kind` ENUM('SOURCE','FINAL_SIGNED') NOT NULL DEFAULT 'SOURCE',
  `original_file_name` VARCHAR(191) NOT NULL,
  `mime_type` VARCHAR(191) NOT NULL,
  `file_size` INT NOT NULL,
  `storage_provider` ENUM('CLOUDINARY','LOCAL_SECURE') NOT NULL DEFAULT 'LOCAL_SECURE',
  `storage_id` VARCHAR(191) NOT NULL,
  `resource_type` VARCHAR(191) NOT NULL DEFAULT 'raw',
  `format` VARCHAR(191) NULL,
  `checksum` VARCHAR(191) NULL,
  `page_count` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `document_files_storageProvider_storageId_kind_key`(`storage_provider`, `storage_id`, `kind`),
  INDEX `document_files_documentId_kind_idx`(`document_id`, `kind`),
  INDEX `document_files_versionId_idx`(`version_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `document_files_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `document_files_versionId_fkey` FOREIGN KEY (`version_id`) REFERENCES `document_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_instances` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `document_id` INT NOT NULL,
  `version_id` INT NOT NULL,
  `document_version` INT NOT NULL,
  `status` ENUM('DRAFT','SUBMITTED','PENDING_APPROVAL','IN_REVIEW','RETURNED_FOR_REVISION','REJECTED','APPROVED','CANCELLED','EXPIRED','ARCHIVED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `current_step_order` INT NULL,
  `total_steps` INT NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `terminated_reason` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `workflow_instances_versionId_key`(`version_id`),
  INDEX `workflow_instances_documentId_status_idx`(`document_id`, `status`),
  INDEX `workflow_instances_status_currentStepOrder_idx`(`status`, `current_step_order`),
  PRIMARY KEY (`id`),
  CONSTRAINT `workflow_instances_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `workflow_instances_versionId_fkey` FOREIGN KEY (`version_id`) REFERENCES `document_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_steps` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workflow_instance_id` INT NOT NULL,
  `step_order` INT NOT NULL,
  `approver_user_id` INT NOT NULL,
  `approver_name_snapshot` VARCHAR(191) NOT NULL,
  `approver_role_snapshot` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','ACTIVE','APPROVED','REJECTED','RETURNED_FOR_REVISION','SKIPPED') NOT NULL DEFAULT 'PENDING',
  `assigned_at` DATETIME(3) NULL,
  `due_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `reason` TEXT NULL,
  `reminded_at` DATETIME(3) NULL,
  `escalated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `workflow_steps_workflowInstanceId_stepOrder_key`(`workflow_instance_id`, `step_order`),
  INDEX `workflow_steps_approverUserId_status_idx`(`approver_user_id`, `status`),
  INDEX `workflow_steps_status_dueAt_idx`(`status`, `due_at`),
  INDEX `workflow_steps_approverUserId_status_dueAt_idx`(`approver_user_id`, `status`, `due_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `workflow_steps_workflowInstanceId_fkey` FOREIGN KEY (`workflow_instance_id`) REFERENCES `workflow_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `workflow_steps_approverUserId_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- `workflow_step_id` is UNIQUE: the database itself guarantees a step can never
-- be decided twice (double-click, two tabs, two concurrent requests).
CREATE TABLE `approvals` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workflow_step_id` INT NOT NULL,
  `document_id` INT NOT NULL,
  `approver_user_id` INT NOT NULL,
  `action` ENUM('APPROVE_AND_SIGN','REJECT','REQUEST_CHANGES') NOT NULL,
  `comments` TEXT NULL,
  `ip_address` VARCHAR(191) NULL,
  `user_agent` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `approvals_workflowStepId_key`(`workflow_step_id`),
  INDEX `approvals_documentId_createdAt_idx`(`document_id`, `created_at`),
  INDEX `approvals_approverUserId_action_idx`(`approver_user_id`, `action`),
  PRIMARY KEY (`id`),
  CONSTRAINT `approvals_workflowStepId_fkey` FOREIGN KEY (`workflow_step_id`) REFERENCES `workflow_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `approvals_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `approvals_approverUserId_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Coordinates are percentages of page width/height (0-100) so browser zoom and
-- screen size never break placement. Rows are written once and never updated.
CREATE TABLE `signature_placements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workflow_step_id` INT NOT NULL,
  `approval_id` INT NOT NULL,
  `signer_user_id` INT NOT NULL,
  `signer_name` VARCHAR(191) NOT NULL,
  `signer_role_snapshot` VARCHAR(191) NOT NULL,
  `signature_storage_id` VARCHAR(191) NOT NULL,
  `signature_provider` VARCHAR(191) NOT NULL,
  `signature_url` VARCHAR(191) NOT NULL,
  `signature_sha256` VARCHAR(191) NOT NULL,
  `page_number` INT NOT NULL,
  `x` DOUBLE NOT NULL,
  `y` DOUBLE NOT NULL,
  `width` DOUBLE NOT NULL,
  `height` DOUBLE NOT NULL,
  `signed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ip_address` VARCHAR(191) NULL,
  UNIQUE INDEX `signature_placements_workflowStepId_key`(`workflow_step_id`),
  UNIQUE INDEX `signature_placements_approvalId_key`(`approval_id`),
  INDEX `signature_placements_signerUserId_idx`(`signer_user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `signature_placements_workflowStepId_fkey` FOREIGN KEY (`workflow_step_id`) REFERENCES `workflow_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `signature_placements_approvalId_fkey` FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `signature_placements_signerUserId_fkey` FOREIGN KEY (`signer_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Append-only audit trail. No update/delete path exists in the application.
CREATE TABLE `document_audit_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `document_id` INT NOT NULL,
  `document_version` INT NOT NULL,
  `workflow_step_id` INT NULL,
  `actor_user_id` INT NULL,
  `action` VARCHAR(191) NOT NULL,
  `previous_status` ENUM('DRAFT','SUBMITTED','PENDING_APPROVAL','IN_REVIEW','RETURNED_FOR_REVISION','REJECTED','APPROVED','CANCELLED','EXPIRED','ARCHIVED') NULL,
  `new_status` ENUM('DRAFT','SUBMITTED','PENDING_APPROVAL','IN_REVIEW','RETURNED_FOR_REVISION','REJECTED','APPROVED','CANCELLED','EXPIRED','ARCHIVED') NULL,
  `reason` TEXT NULL,
  `metadata` JSON NULL,
  `ip_address` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `document_audit_logs_documentId_createdAt_idx`(`document_id`, `created_at`),
  INDEX `document_audit_logs_actorUserId_createdAt_idx`(`actor_user_id`, `created_at`),
  INDEX `document_audit_logs_action_createdAt_idx`(`action`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `document_audit_logs_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `document_audit_logs_actorUserId_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Additive columns on existing tables ───────────────────────────────────────

-- Storage id of the user's saved signature image (Cloudinary public_id or local
-- relative path). `users.signature_url` remains the display URL for the legacy
-- single-stamp approvals; the new module uses this id to build protected links.
ALTER TABLE `users` ADD COLUMN `signature_asset_id` VARCHAR(191) NULL;

-- Which store holds the signature. Frozen per snapshot so historical approvals
-- remain readable even if the deployment later switches storage provider.
ALTER TABLE `users` ADD COLUMN `signature_provider` VARCHAR(191) NULL;

-- Structured settings (the document approval policy) are JSON documents and no
-- longer fit the default VARCHAR(191).
ALTER TABLE `system_settings` MODIFY COLUMN `value` TEXT NOT NULL;

-- Notifications can now deep-link a document and address a specific recipient.
ALTER TABLE `notifications` ADD COLUMN `document_id` INT NULL;
ALTER TABLE `notifications` ADD COLUMN `recipient_user_id` INT NULL;
ALTER TABLE `notifications` ADD INDEX `notifications_documentId_createdAt_idx`(`document_id`, `created_at`);
ALTER TABLE `notifications` ADD INDEX `notifications_recipientUserId_read_createdAt_idx`(`recipient_user_id`, `read`, `created_at`);
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_documentId_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientUserId_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Document notifications are addressed to a single approver, so branch scoping
-- no longer applies to them (branch managers must still receive their own).
-- MySQL stores enums inline on the table, so the column definition is widened
-- in place rather than on a standalone type table.
ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM(
    'MANAGER_REPORT_SUBMITTED',
    'INVENTORY_STATEMENT_SUBMITTED',
    'DOCUMENT_SUBMITTED',
    'DOCUMENT_APPROVED',
    'DOCUMENT_CHANGES_REQUESTED',
    'DOCUMENT_REJECTED',
    'DOCUMENT_FINAL_APPROVED',
    'DOCUMENT_REVISION_CREATED',
    'DOCUMENT_REMINDER',
    'DOCUMENT_ESCALATED'
  ) NOT NULL;

-- ─── Default module policy ─────────────────────────────────────────────────────
-- Read by the document policy service on every submit. Admin-editable from the
-- Document Administration screen.
INSERT INTO `system_settings` (`key`, `value`, `updated_at`)
VALUES
  ('document_policy', '{"hierarchyPolicy":"JUNIOR_TO_SENIOR","minApprovers":1,"maxApprovers":10,"allowCreatorAsApprover":false,"reminderAfterHours":24,"escalateAfterHours":48,"maxApprovalDays":7,"requireSignature":true}', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP(3);