const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initSchema } = require('./schema');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'sales-calendar.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    console.log(`✅ SQLite database ready at ${DB_PATH}`);
  }
  return db;
}

module.exports = { getDb };
