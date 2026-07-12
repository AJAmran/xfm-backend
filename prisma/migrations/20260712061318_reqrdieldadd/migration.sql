/*
  Warnings:

  - Made the column `contact` on table `guest_feedbacks` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `guest_feedbacks` MODIFY `contact` VARCHAR(191) NOT NULL,
    MODIFY `food_rating` INTEGER NULL,
    MODIFY `service_rating` INTEGER NULL,
    MODIFY `environment_rating` INTEGER NULL,
    MODIFY `event_rating` INTEGER NULL,
    MODIFY `overall_rating` INTEGER NULL;
