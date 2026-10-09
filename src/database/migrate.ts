/**
 * ORION Database Migration Runner
 */

import { db } from './client.js';
import { MIGRATIONS } from './schema.js';

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
)
`;

db.exec(MIGRATION_TABLE);

const getAppliedMigrations = db.prepare(`SELECT version FROM migrations ORDER BY version`);
const insertMigration = db.prepare(`INSERT INTO migrations (version, applied_at) VALUES (?, ?)`);
const deleteMigration = db.prepare(`DELETE FROM migrations WHERE version = ?`);

function getCurrentVersion(): number {
  const rows = getAppliedMigrations.all() as { version: number }[];
  return rows.length > 0 ? Math.max(...rows.map((r) => r.version)) : 0;
}

export function migrate(): void {
  const currentVersion = getCurrentVersion();
  console.log(`Current migration version: ${currentVersion}`);

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`Applying migration ${migration.version}...`);
      try {
        db.exec(migration.up);
        insertMigration.run(migration.version, Date.now());
        console.log(`Migration ${migration.version} applied successfully`);
      } catch (error) {
        console.error(`Failed to apply migration ${migration.version}:`, error);
        throw error;
      }
    }
  }

  console.log('All migrations applied');
}

export function rollback(targetVersion: number): void {
  const currentVersion = getCurrentVersion();

  if (targetVersion >= currentVersion) {
    console.log('Target version must be less than current version');
    return;
  }

  for (let v = currentVersion; v > targetVersion; v--) {
    const migration = MIGRATIONS.find((m) => m.version === v);
    if (!migration) {
      console.warn(`No migration found for version ${v}, skipping`);
      continue;
    }

    console.log(`Rolling back migration ${v}...`);
    try {
      db.exec(migration.down);
      deleteMigration.run(v);
      console.log(`Migration ${v} rolled back successfully`);
    } catch (error) {
      console.error(`Failed to rollback migration ${v}:`, error);
      throw error;
    }
  }

  console.log(`Rolled back to version ${targetVersion}`);
}

export function status(): void {
  const currentVersion = getCurrentVersion();
  console.log(`Current version: ${currentVersion}`);
  console.log(`Available migrations: ${MIGRATIONS.length}`);
  console.log('Migrations:');
  for (const m of MIGRATIONS) {
    const applied = m.version <= currentVersion ? '✓' : '○';
    console.log(`  ${applied} v${m.version}`);
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case 'up':
      migrate();
      break;
    case 'down':
      const version = parseInt(process.argv[3] || '0', 10);
      if (!version) {
        console.error('Please specify a version to rollback to');
        process.exit(1);
      }
      rollback(version);
      break;
    case 'status':
      status();
      break;
    default:
      console.log('Usage: npm run db:push [up|down|status] [version]');
      process.exit(1);
  }
}