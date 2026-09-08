-- AlterTable: add branch capacity for booking warnings
ALTER TABLE `branches` ADD COLUMN `capacity` INTEGER NULL;

-- CreateTable: bookings (initial_pax immutable by convention — no update path touches it)
CREATE TABLE `bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_number` VARCHAR(191) NOT NULL,
    `branch_id` INTEGER NOT NULL,
    `guest_name` VARCHAR(191) NOT NULL,
    `guest_mobile` VARCHAR(191) NOT NULL,
    `party_date` DATETIME(3) NOT NULL,
    `party_type` ENUM('LUNCH', 'DINNER') NOT NULL,
    `initial_pax` INTEGER NOT NULL,
    `expected_pax` INTEGER NOT NULL,
    `actual_pax` INTEGER NULL,
    `status` ENUM('TENTATIVE', 'CONFIRMED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'TENTATIVE',
    `remarks` TEXT NULL,
    `confirmed_by_user_id` INTEGER NULL,
    `confirmed_at` DATETIME(3) NULL,
    `cancelled_by_user_id` INTEGER NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancellation_reason` TEXT NULL,
    `completed_by_user_id` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NOT NULL,
    `updated_by_user_id` INTEGER NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `bookings_branch_id_party_date_idx`(`branch_id`, `party_date`),
    INDEX `bookings_party_date_idx`(`party_date`),
    INDEX `bookings_status_idx`(`status`),
    INDEX `bookings_is_deleted_idx`(`is_deleted`),

    UNIQUE INDEX `bookings_booking_number_key`(`booking_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: booking pax adjustments (append-only history)
CREATE TABLE `booking_pax_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_id` INTEGER NOT NULL,
    `type` ENUM('INCREASE', 'DECREASE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `previous_expected_pax` INTEGER NOT NULL,
    `new_expected_pax` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `created_by_user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `booking_pax_adjustments_booking_id_idx`(`booking_id`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: booking status history (audit trail)
CREATE TABLE `booking_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_id` INTEGER NOT NULL,
    `from_status` ENUM('TENTATIVE', 'CONFIRMED', 'CANCELLED', 'COMPLETED') NULL,
    `to_status` ENUM('TENTATIVE', 'CONFIRMED', 'CANCELLED', 'COMPLETED') NOT NULL,
    `reason` TEXT NULL,
    `changed_by_user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `booking_status_history_booking_id_idx`(`booking_id`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_confirmed_by_user_id_fkey` FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_cancelled_by_user_id_fkey` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_completed_by_user_id_fkey` FOREIGN KEY (`completed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_pax_adjustments` ADD CONSTRAINT `booking_pax_adjustments_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_pax_adjustments` ADD CONSTRAINT `booking_pax_adjustments_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_status_history` ADD CONSTRAINT `booking_status_history_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_status_history` ADD CONSTRAINT `booking_status_history_changed_by_user_id_fkey` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
