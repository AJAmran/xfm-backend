-- Age groups realigned to: Below 18, 18-30, 31-45, 45+.
-- Retires AGE_31_50 / AGE_51_PLUS in favour of AGE_31_45 / AGE_45_PLUS.
-- MySQL cannot drop ENUM values that rows still reference, so the new
-- values are added first, existing rows remapped, then old values dropped.

ALTER TABLE `guest_feedbacks` MODIFY `age_group` ENUM('BELOW_18', 'AGE_18_30', 'AGE_31_50', 'AGE_51_PLUS', 'AGE_31_45', 'AGE_45_PLUS') NULL;

UPDATE `guest_feedbacks` SET `age_group` = 'AGE_31_45' WHERE `age_group` = 'AGE_31_50';
UPDATE `guest_feedbacks` SET `age_group` = 'AGE_45_PLUS' WHERE `age_group` = 'AGE_51_PLUS';

ALTER TABLE `guest_feedbacks` MODIFY `age_group` ENUM('BELOW_18', 'AGE_18_30', 'AGE_31_45', 'AGE_45_PLUS') NULL;
