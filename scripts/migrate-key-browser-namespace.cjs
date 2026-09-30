#!/usr/bin/env node
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
/**
 * One-time v1 browser-cookie upgrade preparation. No user data is modified.
 *
 * Preview: node scripts/migrate-key-browser-namespace.cjs --namespace OLD_NAME
 * Apply:   node scripts/migrate-key-browser-namespace.cjs --namespace OLD_NAME --apply
 *
 * Run serially against the database used by the site before removing its old
 * namespace configuration. Install the project's development dependencies first.
 * Remote Cloudflare D1 bindings require execution in their bound environment;
 * do not run this against a local SQLite database expecting to migrate remote D1.
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const namespaceIndex = args.indexOf('--namespace');
if (
  namespaceIndex !== 0 ||
  typeof args[1] !== 'string' ||
  (args.length !== 2 && !(args.length === 3 && args[2] === '--apply'))
) {
  console.error(
    'Usage: node scripts/migrate-key-browser-namespace.cjs --namespace OLD_NAME [--apply]'
  );
  process.exit(1);
}
const namespace = args[1].trim();
if (namespace.length > 1024) {
  console.error('Namespace is too long.');
  process.exit(1);
}

async function main() {
  process.chdir(root);
  const nextEnv = require(require.resolve('@next/env', {
    paths: [require.resolve('next')],
  }));
  nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    throw new Error('A database-backed deployment is required.');
  }
  // Reuse the TypeScript loader bundled with the installed Tailwind dependency.
  // No package is downloaded and this script is never part of the app bundle.
  const createJiti = require(require.resolve('jiti', {
    paths: [require.resolve('tailwindcss')],
  }));
  const jiti = createJiti(__filename, {
    alias: { '@': path.join(root, 'src') },
    interopDefault: true,
  });
  const migration = jiti(
    path.join(root, 'src/lib/key-login-browser-migration.ts')
  );
  const before = await migration.getLegacyKeyBrowserNamespaces();
  if (!args.includes('--apply')) {
    console.log(
      JSON.stringify(
        {
          mode: 'preview',
          alreadyRegistered: !namespace || before.includes(namespace),
          migrationEntries: before.length,
          writes: 0,
        },
        null,
        2
      )
    );
    return;
  }
  await migration.registerLegacyKeyBrowserNamespace(namespace);
  const after = await migration.getLegacyKeyBrowserNamespaces();
  console.log(
    JSON.stringify(
      {
        mode: 'applied',
        registered: !namespace || after.includes(namespace),
        migrationEntries: after.length,
        userDataModified: false,
      },
      null,
      2
    )
  );
}

main().then(
  // Storage adapters may keep sockets open; all reads/writes above are awaited.
  () => process.exit(0),
  () => {
    // Backend errors may contain connection details; do not print credentials.
    console.error(
      'Migration failed. Keep the old configuration and check the database connection.'
    );
    process.exit(1);
  }
);
