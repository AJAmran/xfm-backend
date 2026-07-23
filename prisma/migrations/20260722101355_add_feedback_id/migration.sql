-- AlterTable
ALTER TABLE `guest_feedbacks` ADD COLUMN `feedback_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `guest_feedbacks_feedback_id_idx` ON `guest_feedbacks`(`feedback_id`);
