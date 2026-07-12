/*
  Warnings:

  - You are about to drop the `refresh_tokens` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `refresh_tokens` DROP FOREIGN KEY `refresh_tokens_user_id_fkey`;

-- DropTable
DROP TABLE `refresh_tokens`;

-- CreateIndex
CREATE INDEX `guest_feedbacks_branch_id_submitted_at_idx` ON `guest_feedbacks`(`branch_id`, `submitted_at`);

-- CreateIndex
CREATE INDEX `guest_feedbacks_branch_id_overall_rating_idx` ON `guest_feedbacks`(`branch_id`, `overall_rating`);
