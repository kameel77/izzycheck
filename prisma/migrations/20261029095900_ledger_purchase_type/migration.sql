-- AlterEnum
-- Osobna migracja: PostgreSQL wymaga commitu przed użyciem nowej wartości enuma.
ALTER TYPE "CreditLedgerType" ADD VALUE 'PURCHASE';
