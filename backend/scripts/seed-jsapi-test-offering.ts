import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';
import { seedJsapiTestOffering } from '../packages/modules/src/catalog/repository-adapter/catalog.seeder.js';

const environment = validateEnvironment(process.env);
if (
  environment.PAYMENT_PROVIDER_MODE !== 'WECHAT_PAY' ||
  environment.WECHAT_OAUTH_REDIRECT_ORIGIN !== 'https://test-satori.shenxinyou.com'
) {
  throw new Error('JSAPI test offering can only be seeded in the protected Satori test environment');
}

const { pool, database } = createDatabase(environment);
try {
  await seedJsapiTestOffering(database);
  console.log('JSAPI test offering seeded at CNY 0.01.');
} finally {
  await pool.end();
}
