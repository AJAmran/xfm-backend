-- Perf: composite indexes matching measured query patterns (branch+status+date intersections).
-- Each index serves a recurring WHERE + ORDER BY path; write overhead is one extra
-- B-tree update on low-write operational tables, storage ~ (key bytes x rows).

-- Bookings: branch+status+date (reports, upcoming), branch+type+date (lunch/dinner split), status+date (global upcoming)
CREATE INDEX `bookings_branch_id_status_party_date_idx` ON `bookings`(`branch_id`, `status`, `party_date`);
CREATE INDEX `bookings_branch_id_party_type_party_date_idx` ON `bookings`(`branch_id`, `party_type`, `party_date`);
CREATE INDEX `bookings_status_party_date_idx` ON `bookings`(`status`, `party_date`);

-- Booking history: per-booking chronological reads
CREATE INDEX `booking_pax_adjustments_booking_id_created_at_idx` ON `booking_pax_adjustments`(`booking_id`, `created_at`);
CREATE INDEX `booking_status_history_booking_id_created_at_idx` ON `booking_status_history`(`booking_id`, `created_at`);

-- Manager reports: branch+status+date intersections (list, summary groupBy, calendar)
CREATE INDEX `manager_reports_branch_id_approval_status_idx` ON `manager_reports`(`branch_id`, `approval_status`);
CREATE INDEX `manager_reports_branch_id_report_date_idx` ON `manager_reports`(`branch_id`, `report_date`);
CREATE INDEX `manager_reports_branch_id_approval_status_report_date_idx` ON `manager_reports`(`branch_id`, `approval_status`, `report_date`);

-- Manager report comments: chronological per-report reads
CREATE INDEX `manager_report_comments_report_id_created_at_idx` ON `manager_report_comments`(`report_id`, `created_at`);

-- Notifications: unread bell count + branch feed (branchId+read+createdAt)
CREATE INDEX `notifications_branch_id_read_created_at_idx` ON `notifications`(`branch_id`, `read`, `created_at`);

-- Guest offer logs: branch+status+date intersections (both discount + entertainment)
CREATE INDEX `guest_discount_logs_branch_id_approval_status_idx` ON `guest_discount_logs`(`branch_id`, `approval_status`);
CREATE INDEX `guest_discount_logs_branch_id_approval_status_log_date_idx` ON `guest_discount_logs`(`branch_id`, `approval_status`, `log_date`);
CREATE INDEX `guest_entertainment_logs_branch_id_approval_status_idx` ON `guest_entertainment_logs`(`branch_id`, `approval_status`);
CREATE INDEX `guest_entertainment_logs_branch_id_approval_status_log_date_idx` ON `guest_entertainment_logs`(`branch_id`, `approval_status`, `log_date`);

-- Inventory statements: branch+status and month+branch report scans
CREATE INDEX `monthly_inventory_statements_branch_id_status_idx` ON `monthly_inventory_statements`(`branch_id`, `status`);
CREATE INDEX `monthly_inventory_statements_statement_month_branch_id_idx` ON `monthly_inventory_statements`(`statement_month`, `branch_id`);

-- Branches: active-list scan (isDeleted+isActive)
CREATE INDEX `branches_is_deleted_is_active_idx` ON `branches`(`is_deleted`, `is_active`);
