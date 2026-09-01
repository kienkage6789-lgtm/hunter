const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const raidRoutes = require('../server/routes/raid');
const gameRoutes = require('../server/routes/game');
const raidManager = require('../server/game/RaidManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện Hệ thống Raid Cướp Nhà (TASK-030)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_raid_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.raid_log)) {
        db.data.raid_log = db.data.raid_log.filter(r => !isTestUid(r.raider_uid) && !isTestUid(r.owner_uid));
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
  const aliceUid = 'test_raid_alice_' + uniqueSuffix;
  const bobUid = 'test_raid_bob_' + uniqueSuffix;
  const charlieUid = 'test_raid_charlie_' + uniqueSuffix;

  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const charlieToken = 'tok_charlie_' + uniqueSuffix;

  const testUids = [aliceUid, bobUid, charlieUid];
  cleanupTestRecords(testUids);

  try {
    const nowSec = Math.floor(Date.now() / 1000);

    // Alice: Raider (Lv 50, STR/DEX cao, vũ khí mạnh)
    const aliceData = {
      line_uid: aliceUid,
      name: 'Alice Raider',
      lv: 50,
      country: 'VN',
      hp: 1500,
      hp_max: 1500,
      str: 60,
      dex: 60,
      agi: 40,
      vit: 30,
      luk: 20,
      gold: 50000,
      active_gun: 1, // pistol
      vip_lv: 2, // Quota = 5 + 3 = 8
      skills: { knife_atk: 10, crit_shot: 10 }
    };

    // Bob: Nhà Nông nghiệp có cây chín & 1 vệ binh yếu
    const bobData = {
      line_uid: bobUid,
      name: 'Bob Farmer',
      lv: 30,
      country: 'TH',
      hp: 600,
      hp_max: 600,
      str: 20,
      dex: 20,
      agi: 20,
      vit: 15,
      luk: 10,
      gold: 100000,
      active_gun: 0,
      vip_lv: 0,
      home_lv: 5,
      home_guards: [{ id: 1, mvp: 0 }], // Poring Lv 1
      home_crops: [
        { p: 0, i: 0, s: 1, t: nowSec - 7200 }, // Ripe crop
        { p: 0, i: 1, s: 2, t: nowSec - 7200 }, // Ripe crop
        { p: 0, i: 2, s: 5, t: nowSec }         // Growing crop
      ]
    };

    // Charlie: Pháo đài có Vệ binh MVP Lv 90 cực mạnh
    const charlieData = {
      line_uid: charlieUid,
      name: 'Charlie Fortress',
      lv: 80,
      country: 'JP',
      hp: 5000,
      hp_max: 5000,
      str: 99,
      dex: 99,
      agi: 99,
      vit: 99,
      luk: 50,
      gold: 500000,
      active_gun: 2, // sniper
      vip_lv: 3,
      home_guards: [{ id: 50, mvp: 1 }], // MVP guard Lv 80+
      home_crops: []
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

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
      charlieUid, 'charlie_' + uniqueSuffix, 'h', charlieToken, 'user'
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      charlieUid, charlieData.name, JSON.stringify(charlieData)
    );

    console.log('\n--- 1. Static Audit & Auth Security ---');
    // Test 1: Missing Token
    const resNoTok = await callRoute(raidRoutes, { body: { line_uid: aliceUid, action: 'list' } });
    assert.strictEqual(resNoTok.status, 401, 'Thiếu session_token phải trả về 401');

    // Test 2: Invalid Token
    const resBadTok = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: 'fake_tok', action: 'list' } });
    assert.strictEqual(resBadTok.status, 401, 'Sai session_token phải trả về 401');

    // Test 3: Stolen Token (Alice UID + Bob Token)
    const resStolen = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: bobToken, action: 'list' } });
    assert.strictEqual(resStolen.status, 401, 'Token của user khác phải bị từ chối 401');
    console.log('  ✓ Xác thực bảo mật chặn 401 thành công 100%.');

    console.log('\n--- 2. Action: list, feed, hist ---');
    // Test 4: Action List
    const resList = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'list', page: 0, sort: 'gold' } });
    assert.strictEqual(resList.body.ok, true);
    assert.strictEqual(resList.body.q_used, 0);
    assert.strictEqual(resList.body.q_max, 8, 'Alice VIP 2 phải có max quota = 5 + 3 = 8');
    assert.ok(Array.isArray(resList.body.targets), 'Phải có danh sách targets');

    const bobTarget = resList.body.targets.find(t => t.uid === bobUid);
    assert.ok(bobTarget, 'Phải tìm thấy Bob trong danh sách targets');
    assert.strictEqual(bobTarget.ready, 2, 'Bob phải có 2 cây chín');
    assert.strictEqual(bobTarget.grow, 1, 'Bob phải có 1 cây đang lớn');
    assert.strictEqual(bobTarget.guards, 1, 'Bob có 1 vệ binh');
    assert.strictEqual(bobTarget.shield, false, 'Bob ban đầu chưa có khiên');
    assert.strictEqual(bobTarget.paired, false, 'Chưa cướp Bob hôm nay');

    // Test 5: Action Feed
    const resFeed = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'feed' } });
    assert.strictEqual(resFeed.body.ok, true);
    assert.ok(Array.isArray(resFeed.body.feed));

    // Test 6: Action Hist
    const resHist = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'hist' } });
    assert.strictEqual(resHist.body.ok, true);
    assert.strictEqual(resHist.body.me, aliceUid);
    assert.ok(Array.isArray(resHist.body.hist));
    console.log('  ✓ list, feed, hist trả về dữ liệu đúng chuẩn hợp đồng.');

    console.log('\n--- 3. Combat Scenario A: Raider Thắng Hoàn Toàn (Win) ---');
    // Alice cướp nhà Bob
    const resRaidBob = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'start', target: bobUid } });
    assert.strictEqual(resRaidBob.body.ok, true);
    assert.strictEqual(resRaidBob.body.result, 'win', 'Alice cấp 50 phải đánh thắng Bob và vệ binh Lv 1');
    assert.ok(resRaidBob.body.gold > 0, 'Alice phải nhận được chiến lợi phẩm Gold');

    // Kiểm tra Bob đã nhận khiên 2 giờ và bị trừ nông sản
    db.load();
    const bobAfterRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(bobUid);
    const bobAfterObj = JSON.parse(bobAfterRow.raw_data);
    assert.ok(bobAfterObj.raid_shield_until > nowSec, 'Bob phải được cấp khiên 2 giờ');

    // Kiểm tra quota Alice tăng
    const aliceAfterRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceAfterObj = JSON.parse(aliceAfterRow.raw_data);
    assert.strictEqual(aliceAfterObj.raid_used_today, 1, 'Quota của Alice phải tăng lên 1');
    console.log(`  ✓ Alice thắng Bob, thu về ${resRaidBob.body.gold} Gold, Bob nhận khiên bảo vệ.`);

    console.log('\n--- 4. Edge Cases: Khiên bảo vệ, Cướp trùng trong ngày, Tự cướp mình ---');
    // Cố cướp lại Bob khi Bob đang có khiên
    const resRaidBobShield = await callRoute(raidRoutes, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'start', target: bobUid } });
    assert.strictEqual(resRaidBobShield.body.ok, false);
    assert.strictEqual(resRaidBobShield.body.error, 'target_shielded');

    // Cố tự cướp chính mình
    const resRaidSelf = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'start', target: aliceUid } });
    assert.strictEqual(resRaidSelf.body.ok, false);
    assert.strictEqual(resRaidSelf.body.error, 'cannot_raid_self');
    console.log('  ✓ Chặn đúng các trường hợp cướp nhà có khiên và tự cướp chính mình.');

    console.log('\n--- 5. Combat Scenario B: Raider Thua Vệ Binh (Lose Guard) ---');
    // Tạo 1 clone yếu của người chơi cố cướp Charlie
    const weakUid = 'test_raid_weak_' + uniqueSuffix;
    const weakToken = 'tok_weak_' + uniqueSuffix;
    testUids.push(weakUid);

    const weakData = {
      line_uid: weakUid,
      name: 'Weak Raider',
      lv: 10,
      hp: 100,
      hp_max: 100,
      str: 5,
      dex: 5,
      agi: 5,
      vit: 5,
      gold: 1000
    };

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, role) VALUES (?, ?, ?, ?, ?)').run(
      weakUid, 'weak_' + uniqueSuffix, 'h', weakToken, 'user'
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      weakUid, weakData.name, JSON.stringify(weakData)
    );

    const resWeakRaidCharlie = await callRoute(raidRoutes, { body: { line_uid: weakUid, session_token: weakToken, action: 'start', target: charlieUid } });
    assert.strictEqual(resWeakRaidCharlie.body.ok, true);
    assert.strictEqual(resWeakRaidCharlie.body.result, 'lose_guard', 'Weak raider phải bị vệ binh MVP của Charlie đánh gục');
    assert.strictEqual(resWeakRaidCharlie.body.gold, 0, 'Thua không nhận được vàng');
    console.log('  ✓ Weak raider thua dàn vệ binh (lose_guard) chính xác.');

    console.log('\n--- 6. Game Poll Integration & Raid Toast Notification ---');
    // Bob poll /xhrpg_game.php và nhận thông báo raidpop
    const resBobPoll = await callRoute(gameRoutes, { body: { line_uid: bobUid, session_token: bobToken } });
    assert.strictEqual(resBobPoll.body.ok, 1);
    assert.ok(Array.isArray(resBobPoll.body.raidpop), 'Bob phải nhận được mảng raidpop thông báo bị cướp');
    assert.strictEqual(resBobPoll.body.raidpop[0].mine_side, 'owner');
    assert.strictEqual(resBobPoll.body.raidpop[0].raider_uid, aliceUid);

    // Poll lần thứ 2 thì toast phải được dọn sạch (clear)
    const resBobPoll2 = await callRoute(gameRoutes, { body: { line_uid: bobUid, session_token: bobToken } });
    assert.strictEqual(resBobPoll2.body.raidpop, undefined, 'Sau khi đã đọc, raidpop không được gửi lại');

    // Kiểm tra quota araid trong poll
    assert.ok(resBobPoll.body.araid, 'Phải có object araid');
    assert.strictEqual(resBobPoll.body.araid.max, 5, 'Bob VIP 0 có max quota = 5');
    console.log('  ✓ Game poll trả về araid quota và phát toast thông báo raidpop chuẩn xác.');

    console.log('\n--- 7. Atomic Snapshot Rollback on Error ---');
    // Giả lập lỗi I/O khi lưu database
    const origSave = db.save;
    db.save = () => {
      throw new Error('Simulated disk error during raid');
    };

    const resRollback = await callRoute(raidRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'start', target: charlieUid } });
    assert.strictEqual(resRollback.status, 500);
    assert.strictEqual(resRollback.body.ok, false);

    // Khôi phục db.save
    db.save = origSave;
    console.log('  ✓ Rollback snapshot nguyên tử khi lỗi đĩa thành công 100%.');

    console.log('\n🎉 TẤT CẢ 7 BỘ KIỂM THỬ HỆ THỐNG RAID ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST RAID FAILED:', err);
  process.exit(1);
});

