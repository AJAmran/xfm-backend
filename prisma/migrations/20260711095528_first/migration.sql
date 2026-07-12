/*
  Warnings:

  - You are about to alter the column `latitude` on the `branches` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,8)` to `Decimal(65,30)`.
  - You are about to alter the column `longitude` on the `branches` table. The data in that column could be lost. The data in that column will be cast from `Decimal(11,8)` to `Decimal(65,30)`.

*/
-- AlterTable
ALTER TABLE `branches` MODIFY `address` VARCHAR(191) NOT NULL,
    MODIFY `latitude` DECIMAL(65, 30) NOT NULL,
    MODIFY `longitude` DECIMAL(65, 30) NOT NULL;

-- AlterTable
ALTER TABLE `guest_feedbacks` MODIFY `food_rating` INTEGER NOT NULL,
    MODIFY `service_rating` INTEGER NOT NULL,
    MODIFY `environment_rating` INTEGER NOT NULL,
    MODIFY `event_rating` INTEGER NOT NULL,
    MODIFY `overall_rating` INTEGER NOT NULL,
    MODIFY `opinion` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `system_settings` MODIFY `value` VARCHAR(191) NOT NULL;
