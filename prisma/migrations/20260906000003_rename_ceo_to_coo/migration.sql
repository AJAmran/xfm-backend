-- Rename the CEO executive role to COO (no CEO anymore).
-- Step 1: widen the enum so existing CEO rows can move over.
ALTER TABLE `users` MODIFY `role` ENUM('SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'CEO', 'COO', 'MD') NOT NULL;

-- Step 2: move the data (account keeps its password and signature).
UPDATE `users`
SET `role` = 'COO',
    `name` = 'Chief Operating Officer',
    `email` = 'coo@x-grouprestaurant.com'
WHERE `email` = 'ceo.coo@x-grouprestaurant.com';

-- Step 3: drop CEO from the enum.
ALTER TABLE `users` MODIFY `role` ENUM('SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'COO', 'MD') NOT NULL;
