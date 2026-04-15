const { createClient } = require('@libsql/client');
const { initSchema } = require('./schema');

const DB_URL = process.env.TURSO_DATABASE_URL || 'file:backend/data/sales-calendar.db';
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN;

let clientPromise = null;

async function getDb() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = createClient({
        url: DB_URL,
        authToken: DB_TOKEN || undefined,
      });
      await initSchema(client);
      console.log(`✅ Database ready: ${DB_URL}`);
      return client;
    })();
  }
  return clientPromise;
}

module.exports = { getDb };
