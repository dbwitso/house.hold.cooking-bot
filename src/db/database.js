const { Pool } = require('pg');

let pool = null;
let lastInsertId = null;

async function getDb() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('Pool error:', err);
  });

  await initSchema();
  return pool;
}

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        telegram_id BIGINT UNIQUE,
        house INTEGER NOT NULL,
        queue_position INTEGER NOT NULL,
        owed_turns INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS rotation (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id),
        scheduled_date TEXT,
        status TEXT DEFAULT 'pending',
        covered_by INTEGER REFERENCES members(id),
        swapped_with INTEGER REFERENCES members(id),
        created_at TEXT DEFAULT (now()::text)
      );
      CREATE TABLE IF NOT EXISTS disputes (
        id SERIAL PRIMARY KEY,
        rotation_id INTEGER NOT NULL REFERENCES rotation(id),
        raised_by INTEGER NOT NULL REFERENCES members(id),
        stage TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (now()::text)
      );
      CREATE TABLE IF NOT EXISTS dispute_votes (
        id SERIAL PRIMARY KEY,
        dispute_id INTEGER NOT NULL REFERENCES disputes(id),
        member_id INTEGER NOT NULL REFERENCES members(id),
        vote INTEGER NOT NULL,
        UNIQUE(dispute_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS sub_requests (
        id SERIAL PRIMARY KEY,
        rotation_id INTEGER NOT NULL REFERENCES rotation(id),
        requester_id INTEGER NOT NULL REFERENCES members(id),
        volunteer_id INTEGER REFERENCES members(id),
        status TEXT DEFAULT 'open',
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (now()::text)
      );
      CREATE TABLE IF NOT EXISTS swap_requests (
        id SERIAL PRIMARY KEY,
        requester_rotation_id INTEGER NOT NULL REFERENCES rotation(id),
        target_member_id INTEGER NOT NULL REFERENCES members(id),
        status TEXT DEFAULT 'pending',
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (now()::text)
      );
    `);

    const count = await client.query('SELECT COUNT(*) as c FROM members');
    if (count.rows[0].c === 0) {
      await seedMembers(client);
    }
  } finally {
    client.release();
  }
}

async function seedMembers(client) {
  const members = [
    { name: 'Dabwitso', house: 1, pos: 1 },
    { name: 'Emmanuel', house: 1, pos: 2 },
    { name: 'Muchafara', house: 1, pos: 3 },
    { name: 'Nathan', house: 1, pos: 4 },
    { name: 'Bosco', house: 2, pos: 5 },
    { name: 'Chibili', house: 2, pos: 6 },
  ];

  for (const m of members) {
    await client.query(
      'INSERT INTO members (name, house, queue_position) VALUES ($1, $2, $3)',
      [m.name, m.house, m.pos]
    );
  }
  console.log('✅ Members seeded');
}

async function run(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    if (result.rows.length > 0 && result.rows[0].lastval) {
      lastInsertId = result.rows[0].lastval;
    }
    return result;
  } finally {
    client.release();
  }
}

async function get(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function all(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

function lastId() {
  return lastInsertId;
}

function persist() {
  // PostgreSQL persists automatically, no action needed
}

module.exports = { getDb, run, get, all, lastId, persist };
