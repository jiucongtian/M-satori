import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';

const { pool, database } = createDatabase(validateEnvironment(process.env));

try {
  await migrate(database, { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}
