-- Deduplicate existing feedback_ids, keeping the earliest submission per id.
-- Runs as a no-op where no duplicates exist; required before a unique index
-- can be created on a live table.
DELETE g2 FROM `guest_feedbacks` g2
INNER JOIN `guest_feedbacks` g1
  ON g1.`feedback_id` = g2.`feedback_id`
 AND g1.`id` < g2.`id`
WHERE g2.`feedback_id` IS NOT NULL;

-- DropIndex
DROP INDEX `guest_feedbacks_feedback_id_idx` ON `guest_feedbacks`;

-- CreateIndex
CREATE UNIQUE INDEX `guest_feedbacks_feedback_id_key` ON `guest_feedbacks`(`feedback_id`);