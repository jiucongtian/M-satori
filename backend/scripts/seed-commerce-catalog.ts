import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';
import { seedR11CommerceCatalog } from '../packages/modules/src/catalog/repository-adapter/catalog.seeder.js';

const { pool, database } = createDatabase(validateEnvironment(process.env));

try {
  await seedR11CommerceCatalog(database);
} finally {
  await pool.end();
}
