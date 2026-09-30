-- A newer schedule decision for the same cycle points the pending revision at
-- the new row created in the same transaction, so this reference is checked at commit.
ALTER TABLE "fintrack"."recurring_expense_rule_revision"
  ALTER CONSTRAINT "recurring_expense_rule_revision_superseded_by_id_recurring_expense_rule_revision_id_fk" DEFERRABLE INITIALLY DEFERRED;
