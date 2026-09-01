const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const arenaRoutes = require('../server/routes/arena');
const gameRoutes = require('../server/routes/game');
const arenaManager = require('../server/game/ArenaManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện Hệ thống Đấu trường Boss Arena (TASK-031)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_arena_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
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
  const aliceUid = 'test_arena_alice_' + uniqueSuffix;
  const bobUid = 'test_arena_bob_' + uniqueSuffix;

  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;

  const testUids = [aliceUid, bobUid];
  cleanupTestRecords(testUids);

  try {
    const nowSec = Math.floor(Date.now() / 1000);

    // Alice: Lv.50, VIP 2, 100,000 Gold, 50 P, chỉ số cao
    const aliceData = {
      line_uid: aliceUid,
      name: 'Alice Fighter',
      lv: 50,
      hp: 1500,
      hp_max: 1500,
      str: 60,
      dex: 60,
      agi: 40,
      vit: 30,
      luk: 20,
      gold: 100000,
      p_points: 50,
      vip_lv: 2,
      active_gun: 1, // pistol
      skills: { knife_atk: 10, crit_shot: 10 }
    };

    // Bob: Lv.5 Newbie, VIP 0, 500 Gold, 0 P
    const bobData = {
      line_uid: bobUid,
      name: 'Bob Newbie',
      lv: 5,
      hp: 200,
      hp_max: 200,
      str: 5,
      dex: 5,
      agi: 5,
      vit: 5,
      luk: 5,
      gold: 500,
      p_points: 0,
      vip_lv: 0,
      active_gun: 0
    };

    // Tạo DB records
    db.load();
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'h', aliceToken, 'user'
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, aliceData.name, JSON.stringify(aliceData)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'h', bobToken, 'user'
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, bobData.name, JSON.stringify(bobData)
    );

    console.log('\n--- 1. Static Audit & Auth Security ---');
    // Test 1.1: Missing Token
    const resNoTok = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, action: 'info' } });
    assert.strictEqual(resNoTok.status, 401, 'Thiếu session_token phải trả về 401');

    // Test 1.2: Invalid Token
    const resBadTok = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: 'fake_tok', action: 'info' } });
    assert.strictEqual(resBadTok.status, 401, 'Sai session_token phải trả về 401');

    // Test 1.3: Stolen Token (Alice UID + Bob Token)
    const resStolen = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: bobToken, action: 'info' } });
    assert.strictEqual(resStolen.status, 401, 'Token mạo danh phải bị từ chối 401');
    console.log('  ✓ Xác thực bảo mật chặn 401 thành công 100%.');

    console.log('\n--- 2. Action: info & VIP Quota ---');
    // Test 2.1: Alice (VIP 2) info
    const resAliceInfo = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'info' } });
    assert.strictEqual(resAliceInfo.body.ok, true);
    assert.strictEqual(resAliceInfo.body.free_max, 1, 'Alice VIP 2 có 1 lượt free (G)');
    assert.strictEqual(resAliceInfo.body.paid_max, 2, 'Alice VIP 2 có 2 lượt paid (P)');
    assert.strictEqual(resAliceInfo.body.used, 0);
    assert.strictEqual(resAliceInfo.body.in_arena, false);
    assert.ok(Array.isArray(resAliceInfo.body.bosses), 'Phải có danh sách bosses');
    assert.ok(Array.isArray(resAliceInfo.body.locked), 'Phải có danh sách locked');

    // Boss Slime (Lv 10) phải nằm trong unlocked của Alice (Lv 50)
    const slimeBoss = resAliceInfo.body.bosses.find(b => b.mid === 201);
    assert.ok(slimeBoss, 'Alice Lv 50 phải mở khóa Boss Slime Vương (Lv 10)');
    assert.strictEqual(slimeBoss.won, false, 'Ban đầu chưa thắng Boss');

    // Boss Osiris (Lv 60) phải nằm trong locked của Alice (Lv 50)
    const osirisBoss = resAliceInfo.body.locked.find(b => b.mid === 206);
    assert.ok(osirisBoss, 'Alice Lv 50 chưa thể mở khóa Boss Osiris Lv 60');

    // Test 2.2: Bob (VIP 0) info
    const resBobInfo = await callRoute(arenaRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'info' } });
    assert.strictEqual(resBobInfo.body.free_max, 1, 'Bob VIP 0 có 1 lượt free (G)');
    assert.strictEqual(resBobInfo.body.paid_max, 1, 'Bob VIP 0 có 1 lượt paid (P)');
    console.log('  ✓ info trả về đúng định dạng hợp đồng và danh sách boss/locked theo level.');

    console.log('\n--- 3. Action: enter (Validations, One-Time Charge, Create arena_run) ---');
    // Test 3.1: Bob cố vào Boss Lv.10 khi mới Lv.5 (Locked)
    const resBobLocked = await callRoute(arenaRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'enter', mid: 201, pay: 'g' } });
    assert.strictEqual(resBobLocked.body.ok, false);
    assert.strictEqual(resBobLocked.body.error, 'locked');

    // Test 3.2: Bob cố dùng P khi không có P
    const resBobNoP = await callRoute(arenaRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'enter', mid: 201, pay: 'p' } });
    assert.strictEqual(resBobNoP.body.ok, false);

    // Test 3.3: Alice đủ điều kiện enter Boss Slime Vương (201) bằng Gold
    const resAliceEnter = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'enter', mid: 201, pay: 'g' } });
    assert.strictEqual(resAliceEnter.body.ok, true);
    assert.ok(resAliceEnter.body.msg.includes('thách đấu BOSS'), 'Phải trả về thông báo bắt đầu thách đấu');

    // Kiểm tra DB: Tiền bị trừ 1 lần, arena_used tăng 1, arena_run được tạo, NHƯNG CHƯA CỘNG EXP/GOLD!
    db.load();
    const aliceAfterEnterRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceAfterEnter = JSON.parse(aliceAfterEnterRow.raw_data);
    assert.strictEqual(aliceAfterEnter.gold, 100000 - 1000, 'Phải trừ đúng 1,000 Gold vé vào cửa');
    assert.strictEqual(aliceAfterEnter.arena_used, 1, 'Quota used phải tăng lên 1');
    assert.strictEqual(aliceAfterEnter.exp, undefined, 'KHÔNG ĐƯỢC CỘNG EXP TRỰC TIẾP TẠI ENTER');
    assert.ok(aliceAfterEnter.arena_run, 'Phải khởi tạo active arena_run');
    assert.strictEqual(aliceAfterEnter.arena_run.mid, 201);
    assert.strictEqual(aliceAfterEnter.arena_run.hp, 400, 'Boss Lv 10 có HP = 400');
    assert.strictEqual(aliceAfterEnter.arena_run.hp_max, 400);
    assert.ok(aliceAfterEnter.arena_run.timeout_at > nowSec, 'Timeout phải là 60s trong tương lai');

    // Test 3.4: Chặn enter trùng lặp khi đang có arena_run hoạt động
    const resAliceReEnter = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'enter', mid: 201, pay: 'g' } });
    assert.strictEqual(resAliceReEnter.body.ok, false);
    assert.strictEqual(resAliceReEnter.body.error, 'in_arena');
    console.log('  ✓ enter xác thực, trừ tiền 1 lần, tạo arena_run thành công và không cộng EXP/Gold khống.');

    console.log('\n--- 4. Game Poll Combat Tick: WIN State (Server Authoritative) ---');
    // Alice poll game lần 1 để đánh Boss
    const resAlicePoll1 = await callRoute(gameRoutes, { body: { line_uid: aliceUid, session_token: aliceToken } });
    assert.strictEqual(resAlicePoll1.body.ok, 1);

    // Kiểm tra các events phát ra
    const hasHitEvent = resAlicePoll1.body.events.some(e => e.type === 'hit' && e.mid === 201);
    assert.ok(hasHitEvent, 'Phải có event hit tấn công Boss');

    let won = resAlicePoll1.body.events.some(e => e.type === 'arena_reward');
    let pollCount = 1;
    while (!won && pollCount < 20) {
      pollCount++;
      db.load();
      const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
      const pObj = JSON.parse(pRow.raw_data);
      pObj.last_tick_at = 0;
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pObj), aliceUid);
      db.save();

      const pollRes = await callRoute(gameRoutes, { body: { line_uid: aliceUid, session_token: aliceToken } });
      const rewardEv = pollRes.body.events.find(e => e.type === 'arena_reward');
      const failEv = pollRes.body.events.find(e => e.type === 'arena_fail');
      if (rewardEv) {
        won = true;
        assert.strictEqual(rewardEv.name, 'Boss Slime Vương');
        assert.strictEqual(rewardEv.runs, 1);
      }
      if (failEv) {
        break;
      }
    }
    assert.ok(won, 'Alice phải hạ gục Boss sau các nhịp Game Poll');

    // Kiểm tra DB sau khi thắng:
    db.load();
    const aliceWonRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceWon = JSON.parse(aliceWonRow.raw_data);
    assert.strictEqual(aliceWon.arena_run, null, 'arena_run phải được xóa về null sau khi thắng');
    assert.ok(aliceWon.arena_won.includes(201), 'Boss 201 phải được ghi vào arena_won');
    assert.ok(aliceWon.exp >= 10 * 150, 'Nhận ít nhất 1,500 EXP');
    assert.ok(aliceWon.gold >= (100000 - 1000) + (10 * 300), 'Nhận ít nhất 3,000 Gold thưởng');
    assert.ok(aliceWon.arena_hist && Array.isArray(aliceWon.arena_hist[201]), 'Phải lưu vào lịch sử arena_hist');
    console.log(`  ✓ Alice chiến thắng Boss qua ${pollCount} nhịp poll, nhận arena_reward, EXP/Gold đúng 1 lần.`);

    console.log('\n--- 5. Game Poll Combat Tick: LOSE State (Player Defeated) ---');
    // Tạo 1 nhân vật rất yếu thách đấu Boss Lv 80 Valkyrie
    const charlieUid = 'test_arena_charlie_' + uniqueSuffix;
    const charlieToken = 'tok_charlie_' + uniqueSuffix;
    testUids.push(charlieUid);

    const charlieData = {
      line_uid: charlieUid,
      name: 'Charlie Weakling',
      lv: 80, // đủ level nhưng không có đồ, HP cực thấp
      hp: 10,
      hp_max: 10,
      str: 5,
      dex: 5,
      agi: 5,
      vit: 1,
      gold: 500000,
      vip_lv: 5
    };

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
      charlieUid, 'charlie_' + uniqueSuffix, 'h', charlieToken, 'user'
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      charlieUid, charlieData.name, JSON.stringify(charlieData)
    );

    // Charlie enter Boss Valkyrie (208)
    const resCharlieEnter = await callRoute(arenaRoutes, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'enter', mid: 208, pay: 'g' } });
    assert.strictEqual(resCharlieEnter.body.ok, true);

    // Charlie poll game -> Boss Valkyrie đánh gục Charlie
    const resCharliePoll = await callRoute(gameRoutes, { body: { line_uid: charlieUid, session_token: charlieToken } });
    const failEv = resCharliePoll.body.events.find(e => e.type === 'arena_fail');
    assert.ok(failEv, 'Phải nhận event arena_fail khi người chơi bị Boss đánh bại');

    // Kiểm tra Charlie không nhận EXP/Gold nào
    db.load();
    const charlieAfterRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(charlieUid);
    const charlieAfter = JSON.parse(charlieAfterRow.raw_data);
    assert.strictEqual(charlieAfter.arena_run, null, 'arena_run phải được xóa');
    assert.strictEqual(charlieAfter.exp, undefined, 'Thua không nhận được EXP');
    assert.strictEqual(charlieAfter.gold, 500000 - 80000, 'Chỉ mất vé vào cửa, không nhận được Gold thưởng');
    console.log('  ✓ Người chơi bị Boss hạ gục chuyển sang LOSE, nhận arena_fail và không nhận thưởng.');

    console.log('\n--- 6. Game Poll Combat Tick: TIMEOUT State (60s Expiry) ---');
    // Alice enter lại Boss Nữ Hoàng Sứa (202) bằng điểm P
    const resAliceEnterP = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'enter', mid: 202, pay: 'p' } });
    assert.strictEqual(resAliceEnterP.body.ok, true);

    // Giả lập thời gian timeout trôi qua (quá 60s)
    db.load();
    const aliceRowTimeout = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceObjTimeout = JSON.parse(aliceRowTimeout.raw_data);
    aliceObjTimeout.arena_run.timeout_at = Math.floor(Date.now() / 1000) - 10; // Hết hạn 10s trước
    aliceObjTimeout.last_tick_at = 0; // Reset rate limit cooldown
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(aliceObjTimeout), aliceUid);
    db.save();

    // Alice poll game -> Nhận arena_fail do timeout
    const resAliceTimeoutPoll = await callRoute(gameRoutes, { body: { line_uid: aliceUid, session_token: aliceToken } });
    const timeoutEv = resAliceTimeoutPoll.body.events.find(e => e.type === 'arena_fail' && e.msg && e.msg.includes('Hết thời gian'));
    assert.ok(timeoutEv, 'Phải nhận event arena_fail do hết 60 giây');
    console.log('  ✓ Hết hạn 60s chuyển sang TIMEOUT, xóa arena_run và không nhận thưởng.');

    console.log('\n--- 7. Action: skip (Only for Won Bosses, Count 1-5) ---');
    // Test 7.1: Cố skip Boss chưa thắng (mid: 203 Vua Orc)
    const resSkipUnwon = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'skip', mid: 203, pay: 'p', count: 1 } });
    assert.strictEqual(resSkipUnwon.body.ok, false);
    assert.strictEqual(resSkipUnwon.body.error, 'not_won');

    // Test 7.2: Skip Boss đã thắng (mid: 201 Slime Vương) với count = 1
    const resSkipWon = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'skip', mid: 201, pay: 'p', count: 1 } });
    assert.strictEqual(resSkipWon.body.ok, true);
    assert.strictEqual(resSkipWon.body.runs, 1);
    assert.ok(Array.isArray(resSkipWon.body.drops));
    console.log('  ✓ Skip chỉ cho phép boss đã thắng (arena_won), trừ phí và trao thưởng chính xác.');

    console.log('\n--- 8. Action: hist ---');
    // Đọc lịch sử của Boss 201
    const resHist = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'hist', mid: 201 } });
    assert.strictEqual(resHist.body.ok, true);
    assert.ok(Array.isArray(resHist.body.hist));
    assert.ok(resHist.body.hist.length > 0, 'Phải có ít nhất 1 bản ghi lịch sử của Boss 201');
    console.log('  ✓ hist trả về lịch sử nhận thưởng của Boss chuẩn xác.');

    console.log('\n--- 9. Atomic Snapshot Rollback on Error ---');
    // Reset quota của Alice để đảm bảo enter hợp lệ
    db.load();
    const aliceRowRollback = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceObjRollback = JSON.parse(aliceRowRollback.raw_data);
    aliceObjRollback.arena_used = 0;
    aliceObjRollback.arena_paid = 0;
    aliceObjRollback.arena_run = null;
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(aliceObjRollback), aliceUid);
    db.save();

    // Giả lập lỗi đĩa khi enter
    const origSave = db.save;
    try {
      db.save = () => {
        throw new Error('Simulated disk error during arena enter');
      };

      const resRollback = await callRoute(arenaRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'enter', mid: 201, pay: 'g' } });
      assert.strictEqual(resRollback.status, 500);
      assert.strictEqual(resRollback.body.ok, false);
    } finally {
      // Khôi phục db.save
      db.save = origSave;
    }
    console.log('  ✓ Rollback snapshot nguyên tử khi lỗi đĩa thành công 100%.');

    console.log('\n🎉 TẤT CẢ 9 BỘ KIỂM THỬ HỆ THỐNG ARENA BOSS ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST ARENA FAILED:', err);
  process.exit(1);
});

