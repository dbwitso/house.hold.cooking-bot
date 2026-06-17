const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/cooking.db');
let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  initSchema();
  return db;
}

function persist() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      house INTEGER NOT NULL,
      queue_position INTEGER NOT NULL,
      owed_turns INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS rotation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      scheduled_date TEXT,
      status TEXT DEFAULT 'pending',
      covered_by INTEGER,
      swapped_with INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rotation_id INTEGER NOT NULL,
      raised_by INTEGER NOT NULL,
      stage TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dispute_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispute_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      vote INTEGER NOT NULL,
      UNIQUE(dispute_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS sub_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rotation_id INTEGER NOT NULL,
      requester_id INTEGER NOT NULL,
      volunteer_id INTEGER,
      status TEXT DEFAULT 'open',
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS swap_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_rotation_id INTEGER NOT NULL,
      target_member_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  persist();

  const count = get('SELECT COUNT(*) as c FROM members');
  if (!count || count.c === 0) seedMembers();
}

function seedMembers() {
  const members = [
    { name: 'Dabwitso', house: 1, pos: 1 },
    { name: 'Emmanuel', house: 1, pos: 2 },
    { name: 'Muchafara', house: 1, pos: 3 },
    { name: 'Nathan', house: 1, pos: 4 },
    { name: 'Bosco', house: 2, pos: 5 },
    { name: 'Chibili', house: 2, pos: 6 },
  ];
  for (const m of members) {
    run('INSERT INTO members (name, house, queue_position) VALUES (?,?,?)', [m.name, m.house, m.pos]);
  }
  console.log('✅ Members seeded');
}

// Last inserted rowid helper
function lastId() {
  return get('SELECT last_insert_rowid() as id').id;
}

module.exports = { getDb, run, get, all, lastId, persist };
