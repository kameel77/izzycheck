#!/bin/sh
set -e

echo "==> Running Prisma Database Migrations..."
npx prisma migrate deploy

if [ -n "$INITIAL_ADMIN_EMAIL" ] && [ -n "$INITIAL_ADMIN_PASSWORD" ]; then
  echo "==> Seeding initial admin user from environment variables..."
  node scripts/seed.mjs
fi

echo "==> Starting IzzyCheck Node.js server..."
exec node server.js
