#!/bin/sh
# Testy integracyjne na prawdziwym Postgresie (kredyty, współbieżność).
# Użycie: npm run test:db  (TEST_DATABASE_URL pomija start docker-compose.test.yml)
set -e

cd "$(dirname "$0")/.."

if [ -z "$TEST_DATABASE_URL" ]; then
  docker compose -f docker-compose.test.yml down -v
  docker compose -f docker-compose.test.yml up -d --wait
fi

export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://izzy:izzy@localhost:54329/izzycheck_test}"

npx prisma migrate deploy

FILES=$(find lib/test-db lib/api-clients/tests-db lib/billing/tests-db lib/integrations/mamygo/tests-db lib/invoices/tests-db lib/reports/tests-db -name '*.test.ts' 2>/dev/null | sort)
if [ -z "$FILES" ]; then
  echo "No DB test files found" >&2
  exit 1
fi

# shellcheck disable=SC2086
node --import tsx/esm --test --test-concurrency=1 $FILES
