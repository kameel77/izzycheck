/**
 * Zabezpieczenie helperów testów DB: resetDb() robi TRUNCATE wszystkich tabel,
 * więc wolno go uruchomić wyłącznie na bazie, której nazwa kończy się na "_test".
 */
export function assertTestDatabaseUrl(url: string | undefined): void {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. DB tests must run via `npm run test:db` against a *_test database.",
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("DATABASE_URL is not a valid URL; refusing to run DB tests.");
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run DB tests against database "${databaseName}": its name must end with "_test". ` +
        "Use `npm run test:db`.",
    );
  }
}
