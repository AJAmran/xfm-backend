-- AlterEnum: add CEO and MD executive roles (reports + approvals, all branches)
ALTER TABLE `users` MODIFY `role` ENUM('SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'CEO', 'MD') NOT NULL;
