ALTER TABLE `recurring_rules` ADD `rule_kind` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
UPDATE `recurring_rules`
SET `rule_kind` = 'budget_allocation'
WHERE `type` = 'income'
  AND `memo` = '月初充当'
  AND `day_of_month` = 1
  AND `from_account_id` IS NULL
  AND `card_id` IS NULL;
