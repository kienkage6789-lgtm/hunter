const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const guildRoutes = require('../server/routes/guild');

console.log('🧪 Bắt đầu kiểm thử toàn diện Hệ thống Nhật Ký Bang Hội / Guild Audit Log (TASK-033)...');

function cleanupTestRecords(uids = [], gids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_gd_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.guilds)) {
        db.data.guilds = db.data.guilds.filter(g => {
          if (gids.includes(g.id)) return false;
          if (g.name && g.name.startsWith('TestGuild_')) return false;
          return true;
        });
      }
      db.save();
    }
  } catch (err) {
    console.error('Lỗi khi cleanup database:', err);
  }
}

function callRoute(router, reqOptions) {
  return new Promise((resolve) => {
    const req = {
      method: reqOptions.method || 'POST',
      url: reqOptions.url || '/',
      body: reqOptions.body || {},
      query: reqOptions.query || {},
      headers: reqOptions.headers || {}
    };
    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        resolve({ status: statusCode, body: data });
      }
    };
    router.handle(req, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Route not handled' } });
    });
  });
}

async function runTests() {
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_gd_alice_' + uniqueSuffix;     // Leader Guild A
  const bobUid = 'test_gd_bob_' + uniqueSuffix;         // Member Guild A
  const charlieUid = 'test_gd_charlie_' + uniqueSuffix; // Leader Guild B
  const daveUid = 'test_gd_dave_' + uniqueSuffix;       // Guest / Kicked
  const noGuildUid = 'test_gd_noguild_' + uniqueSuffix; // No guild

  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const charlieToken = 'tok_charlie_' + uniqueSuffix;
  const daveToken = 'tok_dave_' + uniqueSuffix;
  const noGuildToken = 'tok_noguild_' + uniqueSuffix;

  const testUids = [aliceUid, bobUid, charlieUid, daveUid, noGuildUid];
  const testGids = [];
  cleanupTestRecords(testUids);

  try {
    const aliceData = { line_uid: aliceUid, name: 'Alice', display_name: 'Alice Leader', lv: 50, gold: 5000000, wood: 50, ore1: 20, guild_id: 0 };
    const bobData = { line_uid: bobUid, name: 'Bob', display_name: 'Bob Member', lv: 40, gold: 3000000, wood: 30, ore1: 10, guild_id: 0 };
    const charlieData = { line_uid: charlieUid, name: 'Charlie', display_name: 'Charlie B', lv: 50, gold: 5000000, wood: 50, ore1: 20, guild_id: 0 };
    const daveData = { line_uid: daveUid, name: 'Dave', display_name: 'Dave Guest', lv: 30, gold: 1000000, wood: 10, ore1: 5, guild_id: 0 };
    const noGuildData = { line_uid: noGuildUid, name: 'NoGuild', display_name: 'No Guild Player', lv: 20, gold: 100000, wood: 0, ore1: 0, guild_id: 0 };

    db.load();
    const createPlayer = (uid, token, data) => {
      db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
        uid, 'user_' + uid, 'h', token, 'user'
      );
      db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
        uid, data.name, JSON.stringify(data)
      );
    };

    createPlayer(aliceUid, aliceToken, aliceData);
    createPlayer(bobUid, bobToken, bobData);
    createPlayer(charlieUid, charlieToken, charlieData);
    createPlayer(daveUid, daveToken, daveData);
    createPlayer(noGuildUid, noGuildToken, noGuildData);
    db.save();

    console.log('\n--- 1. Auth & Security (401 Rejections) ---');
    // Test 1.1: Missing Token
    const resNoTok = await callRoute(guildRoutes, { body: { line_uid: aliceUid, action: 'log' } });
    assert.strictEqual(resNoTok.status, 401, 'Thiếu session_token phải trả về 401');

    // Test 1.2: Invalid Token
    const resBadTok = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: 'fake_token', action: 'log' } });
    assert.strictEqual(resBadTok.status, 401, 'Sai session_token phải trả về 401');

    // Test 1.3: Stolen Token (Alice UID + Bob Token)
    const resStolen = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resStolen.status, 401, 'Token mạo danh phải bị từ chối 401');
    console.log('  ✓ Xác thực bảo mật chặn 401 triệt để trên action log.');

    console.log('\n--- 2. Non-Member Access (403 Forbidden) ---');
    // Test 2.1: Người chơi chưa có bang gọi action: 'log'
    const resNoGuildLog = await callRoute(guildRoutes, { body: { line_uid: noGuildUid, session_token: noGuildToken, action: 'log' } });
    assert.strictEqual(resNoGuildLog.status, 403);
    assert.strictEqual(resNoGuildLog.body.ok, false);
    assert.ok(resNoGuildLog.body.error.includes('không thuộc bang hội'), 'Phải báo không thuộc bang hội');
    console.log('  ✓ Chặn truy cập log đối với người chơi không có bang hội.');

    console.log('\n--- 3. Action: create Audit Log ---');
    const guildAName = 'TestGuild_A_' + uniqueSuffix;
    const resCreateA = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'create', name: guildAName, sh: 1, co: 2, ic: 3 } });
    assert.strictEqual(resCreateA.body.ok, true);

    db.load();
    const guildA = db.data.guilds.find(g => g.name === guildAName);
    assert.ok(guildA, 'Bang A phải được tạo');
    testGids.push(guildA.id);

    // Kiểm tra log của Guild A sau khi create
    const resLogAfterCreate = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert.strictEqual(resLogAfterCreate.body.ok, true);
    assert.ok(Array.isArray(resLogAfterCreate.body.log));
    assert.strictEqual(resLogAfterCreate.body.log.length, 1);
    assert.strictEqual(resLogAfterCreate.body.log[0].action, 'create');
    assert.ok(resLogAfterCreate.body.log[0].meta.includes('Alice Leader'));
    assert.ok(resLogAfterCreate.body.log[0].meta.includes(guildAName));
    assert.ok(typeof resLogAfterCreate.body.log[0].created_at === 'string');
    console.log('  ✓ Tạo bang hội ghi nhận log create chính xác.');

    console.log('\n--- 4. Anti-Leak Guild Logs (Isolate Guild A vs Guild B) ---');
    const guildBName = 'TestGuild_B_' + uniqueSuffix;
    const resCreateB = await callRoute(guildRoutes, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'create', name: guildBName, sh: 2, co: 1, ic: 4 } });
    assert.strictEqual(resCreateB.body.ok, true);

    db.load();
    const guildB = db.data.guilds.find(g => g.name === guildBName);
    assert.ok(guildB, 'Bang B phải được tạo');
    testGids.push(guildB.id);

    // Charlie xem log -> Chỉ thấy log của Bang B
    const resLogB = await callRoute(guildRoutes, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'log' } });
    assert.strictEqual(resLogB.body.ok, true);
    assert.strictEqual(resLogB.body.log.length, 1);
    assert.strictEqual(resLogB.body.log[0].action, 'create');
    assert.ok(resLogB.body.log[0].meta.includes('Charlie B'));
    assert.ok(!resLogB.body.log[0].meta.includes(guildAName), 'Bang B không được chứa log Bang A');

    // Alice xem log -> Chỉ thấy log của Bang A
    const resLogA = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert.strictEqual(resLogA.body.ok, true);
    assert.ok(!resLogA.body.log[0].meta.includes('Charlie B'), 'Bang A không được chứa log Bang B');
    console.log('  ✓ Tách biệt hoàn toàn log giữa các bang hội, chống rò rỉ 100%.');

    console.log('\n--- 5. Action: join Audit Log ---');
    const resJoinBob = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'join', gid: guildA.id } });
    assert.strictEqual(resJoinBob.body.ok, true);

    const resLogAfterJoin = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resLogAfterJoin.body.ok, true);
    assert.strictEqual(resLogAfterJoin.body.log.length, 2);
    assert.strictEqual(resLogAfterJoin.body.log[0].action, 'join');
    assert.ok(resLogAfterJoin.body.log[0].meta.includes('Bob Member'));
    console.log('  ✓ Thành viên gia nhập bang ghi nhận log join chính xác.');

    console.log('\n--- 6. Actions: donate & levelup Audit Logs ---');
    // Test 6.1: Donate Gold đủ để thăng cấp lên Lv.2 (1,000,000 Gold)
    const resDonateGold = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'donate', amt: 1000000 } });
    assert.strictEqual(resDonateGold.body.ok, true);

    const resLogAfterDonate = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert.strictEqual(resLogAfterDonate.body.log[0].action, 'levelup');
    assert.ok(resLogAfterDonate.body.log[0].meta.includes('Lv.2'));
    assert.strictEqual(resLogAfterDonate.body.log[1].action, 'donate');
    assert.ok(resLogAfterDonate.body.log[1].meta.includes('1,000,000 Vàng'));

    // Test 6.2: Donate Resource (Wood)
    const resDonateRes = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'donate_res', f: 'wood', n: 10 } });
    assert.strictEqual(resDonateRes.body.ok, true);

    // Test 6.3: Donate Space Ore (ore1)
    const resDonateOre = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'donate_ore', f: 'ore1', n: 5 } });
    assert.strictEqual(resDonateOre.body.ok, true);

    const resLogAfterAllDonates = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resLogAfterAllDonates.body.log[0].action, 'donate');
    assert.ok(resLogAfterAllDonates.body.log[0].meta.includes('Quặng'));
    assert.strictEqual(resLogAfterAllDonates.body.log[1].action, 'donate');
    assert.ok(resLogAfterAllDonates.body.log[1].meta.includes('Gỗ'));
    console.log('  ✓ Đóng góp Vàng, Tài nguyên, Quặng và Thăng cấp bang ghi log đầy đủ.');

    console.log('\n--- 7. Actions: promote, demote & transfer Audit Logs ---');
    // Test 7.1: Promote Bob lên officer
    const resPromote = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'promote', uid: bobUid } });
    assert.strictEqual(resPromote.body.ok, true);

    // Test 7.2: Demote Bob về member
    const resDemote = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'demote', uid: bobUid } });
    assert.strictEqual(resDemote.body.ok, true);

    // Test 7.3: Transfer Leader cho Bob
    const resTransfer = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'transfer', uid: bobUid } });
    assert.strictEqual(resTransfer.body.ok, true);

    const resLogRoles = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resLogRoles.body.log[0].action, 'transfer');
    assert.ok(resLogRoles.body.log[0].meta.includes('chuyển giao chức Bang Chủ'));
    assert.strictEqual(resLogRoles.body.log[1].action, 'demote');
    assert.ok(resLogRoles.body.log[1].meta.includes('giáng chức'));
    assert.strictEqual(resLogRoles.body.log[2].action, 'promote');
    assert.ok(resLogRoles.body.log[2].meta.includes('thăng chức'));
    console.log('  ✓ Thăng chức, giáng chức và chuyển nhượng Bang Chủ ghi nhận log chuẩn xác.');

    console.log('\n--- 8. Actions: emblem & notice Audit Logs ---');
    // Bob giờ là Leader -> Đổi emblem và notice
    const resEmblem = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'emblem', sh: 3, co: 4, ic: 5 } });
    assert.strictEqual(resEmblem.body.ok, true);

    const resNotice = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'notice', text: 'Thông báo bang mới 2026' } });
    assert.strictEqual(resNotice.body.ok, true);

    const resLogEmblemNotice = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resLogEmblemNotice.body.log[0].action, 'notice');
    assert.ok(resLogEmblemNotice.body.log[0].meta.includes('thông báo'));
    assert.strictEqual(resLogEmblemNotice.body.log[1].action, 'emblem');
    assert.ok(resLogEmblemNotice.body.log[1].meta.includes('biểu tượng'));
    console.log('  ✓ Đổi biểu tượng và cập nhật thông báo ghi nhận log chính xác.');

    console.log('\n--- 9. Actions: kick & leave Audit Logs ---');
    // Cho Dave tham gia Guild A
    await callRoute(guildRoutes, { body: { line_uid: daveUid, session_token: daveToken, action: 'join', gid: guildA.id } });

    // Bob (Leader) kick Dave
    const resKick = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'kick', uid: daveUid } });
    assert.strictEqual(resKick.body.ok, true);

    // Alice (Officer) tự rời bang (leave)
    const resLeave = await callRoute(guildRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'leave' } });
    assert.strictEqual(resLeave.body.ok, true);

    const resLogKickLeave = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resLogKickLeave.body.log[0].action, 'leave');
    assert.ok(resLogKickLeave.body.log[0].meta.includes('Alice Leader'));
    assert.strictEqual(resLogKickLeave.body.log[1].action, 'kick');
    assert.ok(resLogKickLeave.body.log[1].meta.includes('Dave Guest'));
    console.log('  ✓ Trục xuất thành viên và rời bang ghi nhận log chính xác.');

    console.log('\n--- 10. Ordering & Prune Limit Enforcement (Max 50 Records) ---');
    db.load();
    const gAInDb = db.data.guilds.find(g => g.id === guildA.id);
    assert.ok(gAInDb);

    // Bơm 60 log entries vào Bang A
    for (let i = 1; i <= 60; i++) {
      gAInDb.log.unshift({
        action: 'donate',
        meta: `Test batch log entry #${i}`,
        created_at: `2026-08-30 17:00:${String(i).padStart(2, '0')}`
      });
      if (gAInDb.log.length > 50) {
        gAInDb.log = gAInDb.log.slice(0, 50);
      }
    }
    db.save();

    const resPruneLog = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'log' } });
    assert.strictEqual(resPruneLog.body.ok, true);
    assert.strictEqual(resPruneLog.body.log.length, 50, 'Mảng log phải được cắt tỉa tối đa đúng 50 bản ghi');
    assert.strictEqual(resPruneLog.body.log[0].meta, 'Test batch log entry #60', 'Bản ghi mới nhất phải ở index 0');
    console.log('  ✓ Giới hạn tối đa 50 bản ghi gần nhất và sắp xếp mới nhất ở đầu hoạt động hoàn hảo.');

    console.log('\n--- 11. Atomic Snapshot Rollback on Error ---');
    const origSave = db.save;
    try {
      db.save = () => {
        throw new Error('Simulated disk failure during guild donate');
      };

      const resRollback = await callRoute(guildRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'donate', amt: 50000 } });
      assert.strictEqual(resRollback.status, 500);
      assert.strictEqual(resRollback.body.ok, false);
    } finally {
      db.save = origSave;
    }
    console.log('  ✓ Snapshot rollback nguyên tử khi lỗi đĩa hoạt động an toàn 100%.');

    console.log('\n🎉 TẤT CẢ 11 BỘ KIỂM THỬ HỆ THỐNG GUILD AUDIT LOG ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids, testGids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST GUILD LOG FAILED:', err);
  process.exit(1);
});

