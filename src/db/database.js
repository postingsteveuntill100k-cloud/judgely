const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DB_DIR, 'judgely.db');

let instance = null;

function getDb(inMemory = false) {
  if (inMemory) {
    const memDb = new DatabaseSync(':memory:');
    initSchema(memDb);
    return memDb;
  }

  if (!instance) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    instance = new DatabaseSync(DB_PATH);
    instance.exec('PRAGMA journal_mode = WAL;');
    instance.exec('PRAGMA foreign_keys = ON;');
    initSchema(instance);

    // Auto-seed fixtures if database is unseeded
    const event = instance.prepare('SELECT id FROM events WHERE id = ?').get('evt_01');
    if (!event) {
      const { seed } = require('./seeder');
      seed(instance);
    }
  }

  return instance;
}

function initSchema(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
}

module.exports = {
  getDb,
  DB_PATH
};
