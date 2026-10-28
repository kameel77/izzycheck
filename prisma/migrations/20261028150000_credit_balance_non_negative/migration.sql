ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_balance_non_negative" CHECK ("balance" >= 0);
