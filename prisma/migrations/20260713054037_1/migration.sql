-- CreateIndex
CREATE INDEX `guest_feedbacks_overall_rating_idx` ON `guest_feedbacks`(`overall_rating`);

-- CreateIndex
CREATE INDEX `guest_feedbacks_overall_rating_submitted_at_idx` ON `guest_feedbacks`(`overall_rating`, `submitted_at`);
