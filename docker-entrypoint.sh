#!/bin/sh
set -e

echo "==> Running Prisma Database Migrations..."
npx prisma migrate deploy || echo "Warning: Prisma migration deploy skipped or failed."

if [ -n "$INITIAL_ADMIN_EMAIL" ] && [ -n "$INITIAL_ADMIN_PASSWORD" ]; then
  echo "==> Seeding initial admin user..."
  node scripts/seed.mjs || echo "Warning: User seeding skipped."
fi

echo "==> Starting IzzyCheck Node.js server..."
exec node server.js
