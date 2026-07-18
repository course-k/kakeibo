CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `recurring_rules` ADD `category_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_id` text;--> statement-breakpoint
INSERT INTO `categories` (`id`, `name`, `kind`, `sort_order`, `archived_at`, `created_at`, `updated_at`)
VALUES
	('default-expense-other', 'その他支出', 'expense', 1000000, NULL, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
	('default-income-other', 'その他収入', 'income', 1000000, NULL, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `categories` (`id`, `name`, `kind`, `sort_order`, `archived_at`, `created_at`, `updated_at`)
SELECT 'legacy-budget-' || `id`, `name`, 'expense', `sort_order`, `archived_at`, `created_at`, `updated_at`
FROM `accounts`
WHERE `type` = 'budget';--> statement-breakpoint
UPDATE `transactions`
SET `category_id` = 'legacy-budget-' || `from_account_id`
WHERE `type` IN ('expense_cash', 'expense_card') AND `from_account_id` IS NOT NULL;--> statement-breakpoint
UPDATE `recurring_rules`
SET `category_id` = 'legacy-budget-' || `from_account_id`
WHERE `type` IN ('expense_cash', 'expense_card') AND `from_account_id` IS NOT NULL;
