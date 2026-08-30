const assert = require('assert');
const db = require('../server/db/queries');
const warpRoute = require('../server/routes/warp');

const uid = `test_reconnect_${Date.now()}`;
const token = `token_${Date.now()}`;

function callWarp(body) {
  return Promise.race([
    new Promise((resolve, reject) => warpRoute.handle(
      { method: 'POST', url: '/', body: { line_uid: uid, ...body } },
      { json: resolve },
      reject
    )),
    new Promise((_, reject) => setTimeout(() => reject(new Error('warp timeout after 5s')), 5000))
  ]);
}

async function main() {
  db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)')
    .run(uid, 'reconnect_test', 'hash', token);
  const state = { line_uid: uid, name: 'Reconnect', lv: 30, hp: 80, hp_max: 300, exp: 10, gold: 20, map: 1, x: 1000, y: 1000, target_monster_id: 12345 };
  db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(uid, state.name, JSON.stringify(state));
  try {
    const moved = await callWarp({ target_map: 2 });
    assert.strictEqual(moved.ok, true);
    assert.strictEqual(moved.map, 2);
    const row = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(uid);
    const persisted = JSON.parse(row.raw_data);
    assert.strictEqual(persisted.map, 2);
    assert.strictEqual(persisted.x, 1125);
    assert.strictEqual(persisted.target_monster_id, null);

    const reconnected = await callWarp({});
    assert.strictEqual(reconnected.ok, true);
    assert.strictEqual(reconnected.map, 2);
    assert.strictEqual(reconnected.x, 1125);
    assert.strictEqual(reconnected.y, 1125);

    const home = await callWarp({ target_map: 5 });
    assert.strictEqual(home.ok, true);
    assert.strictEqual(home.map, 5);
    assert.strictEqual(home.x, 928);
    assert.strictEqual(home.y, 780);
    const exited = await callWarp({ home_exit: 1 });
    assert.strictEqual(exited.ok, true);
    assert.strictEqual(exited.map, 2);
    assert.strictEqual(exited.x, 1125);
  } finally {
    db.prepare('DELETE FROM players WHERE line_uid = ?').run(uid);
    db.prepare('DELETE FROM users WHERE line_uid = ?').run(uid);
  }
  console.log('TASK-GP-004: reconnect/map reset 4/4 passed');
}

main().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
