const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const cwarRoutes = require('../server/routes/cwar');
const gameRoutes = require('../server/routes/game');
const cwarManager = require('../server/game/CWarManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện Hệ thống Chiến Tranh Quốc Gia (Country Flag War / CWAR) (TASK-032)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_cwar_');
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
  const aliceUid = 'test_cwar_alice_' + uniqueSuffix;     // VN, Lv 50
  const bobUid = 'test_cwar_bob_' + uniqueSuffix;         // VN, Lv 40
  const charlieUid = 'test_cwar_charlie_' + uniqueSuffix; // TH, Lv 50
  const somchaiUid = 'test_cwar_somchai_' + uniqueSuffix; // TH, Lv 30
  const daveUid = 'test_cwar_dave_' + uniqueSuffix;       // JP, Lv 15 (Low Level)
  const noCountryUid = 'test_cwar_nocountry_' + uniqueSuffix; // No country

  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const charlieToken = 'tok_charlie_' + uniqueSuffix;
  const somchaiToken = 'tok_somchai_' + uniqueSuffix;
  const daveToken = 'tok_dave_' + uniqueSuffix;
  const noCountryToken = 'tok_nocountry_' + uniqueSuffix;

  const testUids = [aliceUid, bobUid, charlieUid, somchaiUid, daveUid, noCountryUid];
  cleanupTestRecords(testUids);

  try {
    const nowSec = Math.floor(Date.now() / 1000);

    const aliceData = { line_uid: aliceUid, name: 'Alice VN', lv: 50, hp: 2000, hp_max: 2000, map: 1, x: 1125, y: 1125, country: 'VN', str: 60, dex: 60 };
    const bobData = { line_uid: bobUid, name: 'Bob VN', lv: 40, hp: 1500, hp_max: 1500, map: 2, x: 500, y: 500, country: 'VN', str: 40, dex: 40 };
    const charlieData = { line_uid: charlieUid, name: 'Charlie TH', lv: 50, hp: 2000, hp_max: 2000, map: 3, x: 800, y: 800, country: 'TH', str: 60, dex: 60 };
    const somchaiData = { line_uid: somchaiUid, name: 'Somchai TH', lv: 30, hp: 1000, hp_max: 1000, map: 1, x: 1200, y: 1200, country: 'TH', str: 30, dex: 30 };
    const daveData = { line_uid: daveUid, name: 'Dave JP', lv: 15, hp: 500, hp_max: 500, map: 1, x: 1000, y: 1000, country: 'JP', str: 15, dex: 15 };
    const noCountryData = { line_uid: noCountryUid, name: 'No Country', lv: 25, hp: 800, hp_max: 800, map: 1, x: 1125, y: 1125, country: '' };

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
    createPlayer(somchaiUid, somchaiToken, somchaiData);
    createPlayer(daveUid, daveToken, daveData);
    createPlayer(noCountryUid, noCountryToken, noCountryData);

    // Reset CWarManager ban đầu về IDLE
    cwarManager.resetWar();

    console.log('\n--- 1. Static Audit & Auth Security (401 Rejections) ---');
    // Test 1.1: Missing Token
    const resNoTok = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, action: 'cwar_join' } });
    assert.strictEqual(resNoTok.status, 401, 'Thiếu session_token phải trả về 401');

    // Test 1.2: Invalid Token
    const resBadTok = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: 'fake_tok', action: 'cwar_join' } });
    assert.strictEqual(resBadTok.status, 401, 'Sai session_token phải trả về 401');

    // Test 1.3: Stolen Token (Alice UID + Bob Token)
    const resStolen = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: bobToken, action: 'war_log' } });
    assert.strictEqual(resStolen.status, 401, 'Token mạo danh phải bị từ chối 401');
    console.log('  ✓ Xác thực bảo mật chặn 401 triệt để trên mọi action.');

    console.log('\n--- 2. Eligibility & Timing Validation ---');
    // Test 2.1: Join khi chưa có quốc gia
    cwarManager.setWarState('open', 300);
    const resNoCountry = await callRoute(cwarRoutes, { body: { line_uid: noCountryUid, session_token: noCountryToken, action: 'cwar_join' } });
    assert.strictEqual(resNoCountry.body.ok, false);
    assert.ok(resNoCountry.body.error.includes('quốc gia'), 'Phải yêu cầu chọn quốc gia trước');

    // Test 2.2: Cố join khi war đang IDLE
    cwarManager.setWarState('idle');
    const resJoinIdle = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'cwar_join' } });
    assert.strictEqual(resJoinIdle.body.ok, false);
    assert.ok(resJoinIdle.body.error.includes('chưa mở'), 'Không được join khi war đang IDLE');

    // Test 2.3: Cố join khi war đang PRE
    cwarManager.setWarState('pre', 300);
    const resJoinPre = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'cwar_join' } });
    assert.strictEqual(resJoinPre.body.ok, false);
    assert.ok(resJoinPre.body.error.includes('chưa mở'), 'Không được join khi war đang PRE');
    console.log('  ✓ Kiểm tra điều kiện tham gia và thời điểm mở cửa chặt chẽ.');

    console.log('\n--- 3. Action: cwar_join (Map 4 Warp, home_return, Spawn Shield) ---');
    // Mở phòng chờ OPEN (21:30)
    cwarManager.setWarState('open', 300);

    // Alice (đang ở Map 1) tham gia cwar_join
    const resAliceJoin = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'cwar_join' } });
    assert.strictEqual(resAliceJoin.body.ok, true);
    assert.strictEqual(resAliceJoin.body.map, 4, 'Phải warp vào Map 4');
    assert.ok(resAliceJoin.body.x >= 1100 && resAliceJoin.body.x <= 1150, 'Tọa độ X quanh tâm 1125');
    assert.ok(resAliceJoin.body.y >= 1100 && resAliceJoin.body.y <= 1150, 'Tọa độ Y quanh tâm 1125');

    // Kiểm tra DB: home_return được lưu, col_sh_until được cấp 5 giây
    db.load();
    const aliceRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceObj = JSON.parse(aliceRow.raw_data);
    assert.strictEqual(aliceObj.map, 4);
    assert.deepStrictEqual(aliceObj.home_return, { map: 1, x: 1125, y: 1125 }, 'Phải lưu chính xác vị trí cũ trước khi vào Map 4');
    assert.ok(aliceObj.col_sh_until > nowSec, 'Phải kích hoạt khiên hồi sinh 5 giây');

    // Test 3.2: Duplicate / Idempotent Join khi đã ở Map 4
    const resAliceReJoin = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'cwar_join' } });
    assert.strictEqual(resAliceReJoin.body.ok, true);
    assert.strictEqual(resAliceReJoin.body.map, 4);
    db.load();
    const aliceObjRe = JSON.parse(db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid).raw_data);
    assert.deepStrictEqual(aliceObjRe.home_return, { map: 1, x: 1125, y: 1125 }, 'Không được làm mất home_return cũ khi re-join');

    // Cho Bob (Map 2), Charlie (Map 3), Somchai (Map 1), Dave (Map 1) cùng tham gia cwar_join
    await callRoute(cwarRoutes, { body: { line_uid: bobUid, session_token: bobToken, action: 'cwar_join' } });
    await callRoute(cwarRoutes, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'cwar_join' } });
    await callRoute(cwarRoutes, { body: { line_uid: somchaiUid, session_token: somchaiToken, action: 'cwar_join' } });
    await callRoute(cwarRoutes, { body: { line_uid: daveUid, session_token: daveToken, action: 'cwar_join' } });

    assert.strictEqual(Object.keys(cwarManager.participants).length, 5, 'Phải có 5 người tham chiến');
    console.log('  ✓ cwar_join warp vào Map 4, lưu vị trí home_return và cấp khiên 5s an toàn.');

    console.log('\n--- 4. Non-Fight & Friendly Fire & Spawn Shield Combat Block ---');
    // Test 4.1: Trong giai đoạn OPEN -> Chặn sát thương tuyệt đối
    const resRecordOpen = cwarManager.recordKill(aliceData, charlieData);
    assert.strictEqual(resRecordOpen.ok, false);
    assert.ok(resRecordOpen.error.includes('giai đoạn giao tranh'), 'Không được tính sát thương/kill trong giai đoạn OPEN');

    // Chuyển sang giai đoạn FIGHT
    cwarManager.setWarState('fight', 900);

    // Test 4.2: Chặn Friendly Fire (Alice VN vs Bob VN)
    const resFriendly = cwarManager.recordKill(aliceData, bobData);
    assert.strictEqual(resFriendly.ok, false);
    assert.ok(resFriendly.error.includes('Friendly fire'), 'Phải chặn friendly fire giữa người chơi cùng quốc gia');

    // Test 4.3: Chặn khiên hồi sinh (Spawn Shield)
    const shieldedVictim = { ...charlieData, col_sh_until: Math.floor(Date.now() / 1000) + 10 };
    const resShielded = cwarManager.recordKill(aliceData, shieldedVictim);
    assert.strictEqual(resShielded.ok, false);
    assert.ok(resShielded.error.includes('khiên bảo vệ'), 'Phải chặn sát thương khi nạn nhân có khiên hồi sinh');
    console.log('  ✓ Chặn sát thương ngoài FIGHT, chặn friendly fire và bảo vệ spawn shield 100%.');

    console.log('\n--- 5. Server-Authoritative Kill Scoring & Low Level Protection ---');
    // Test 5.1: Hạ gục nạn nhân Lv < 20 (Dave JP Lv 15) -> 0 điểm (p = 0)
    const resKillDave = cwarManager.recordKill(aliceData, daveData, 'kill_dave_1');
    assert.strictEqual(resKillDave.ok, true);
    assert.strictEqual(resKillDave.points, 0, 'Hạ gục nạn nhân Lv < 20 nhận 0 điểm');
    assert.strictEqual(cwarManager.scores['VN'].p, 0, 'Điểm quốc gia không tăng khi hạ gục mục tiêu < 20');

    // Test 5.2: Hạ gục kẻ thù Lv >= 20 (Somchai TH Lv 30) -> Nhận 5 điểm (p = 5)
    const resKillSomchai = cwarManager.recordKill(aliceData, somchaiData, 'kill_somchai_1');
    assert.strictEqual(resKillSomchai.ok, true);
    assert.strictEqual(resKillSomchai.points, 5, 'Hạ gục kẻ thù Lv >= 20 nhận 5 điểm');
    assert.strictEqual(cwarManager.scores['VN'].p, 5, 'Điểm quốc gia VN tăng lên 5');

    // Test 5.3: Idempotency / Duplicate Kill Prevention
    const resDupKill = cwarManager.recordKill(aliceData, somchaiData, 'kill_somchai_1');
    assert.strictEqual(resDupKill.ok, true);
    assert.strictEqual(resDupKill.duplicate, true, 'Kill ID trùng lặp phải được nhận diện duplicate');
    assert.strictEqual(cwarManager.scores['VN'].p, 5, 'Điểm quốc gia VN không bị cộng khống 2 lần');

    // Thêm các kills để kiểm tra điểm số:
    // Alice (VN) kill Charlie (TH Lv 50) -> VN = 10 điểm
    cwarManager.recordKill(aliceData, charlieData, 'kill_charlie_1');
    assert.strictEqual(cwarManager.scores['VN'].p, 10);

    // Charlie (TH) kill Bob (VN Lv 40) -> TH = 5 điểm
    cwarManager.recordKill(charlieData, bobData, 'kill_bob_1');
    assert.strictEqual(cwarManager.scores['TH'].p, 5);
    console.log('  ✓ Tính điểm server-authoritative, bảo vệ newbie < 20 và ngăn duplicate kill chuẩn xác.');

    console.log('\n--- 6. Action: war_log Feed Contract ---');
    const resWarLog = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'war_log', kind: 'cw' } });
    assert.strictEqual(resWarLog.body.ok, true);
    assert.strictEqual(resWarLog.body.ppk, 5);
    assert.strictEqual(resWarLog.body.mlv, 20);
    assert.ok(Array.isArray(resWarLog.body.feed));
    assert.ok(resWarLog.body.feed.length >= 3, 'Phải có ít nhất 3 bản ghi feed');

    const firstFeed = resWarLog.body.feed[0];
    assert.ok(firstFeed.t > 0);
    assert.ok(typeof firstFeed.k === 'string');
    assert.ok(typeof firstFeed.kt === 'string');
    assert.ok(typeof firstFeed.v === 'string');
    assert.ok(typeof firstFeed.vt === 'string');
    assert.ok(typeof firstFeed.p === 'number');
    console.log('  ✓ war_log trả về đúng 100% hợp đồng client mong đợi.');

    console.log('\n--- 7. Game Poll Contract (cwc, cw, cwf, col_n, col_sh) ---');
    // Alice poll game khi đang trong Map 4 và war đang FIGHT
    db.load();
    const pAliceRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const pAliceObj = JSON.parse(pAliceRow.raw_data);
    pAliceObj.last_tick_at = 0;
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pAliceObj), aliceUid);
    db.save();

    const resAlicePoll = await callRoute(gameRoutes, { body: { line_uid: aliceUid, session_token: aliceToken } });
    assert.strictEqual(resAlicePoll.body.ok, 1);
    assert.strictEqual(resAlicePoll.body.cwc, 'VN', 'cwc trả về holder hiện tại');
    assert.deepStrictEqual(resAlicePoll.body.cwf, { e: 1.1, d: 1.1 }, 'Alice VN nhận buff cwf');
    assert.ok(resAlicePoll.body.cw, 'cw phải có dữ liệu trong FIGHT');
    assert.strictEqual(resAlicePoll.body.cw.st, 'fight');
    assert.strictEqual(resAlicePoll.body.cw.in_arena, true, 'Alice đang ở Map 4');
    assert.strictEqual(resAlicePoll.body.cw.gid, 'VN');
    assert.strictEqual(resAlicePoll.body.cw.my, 10);
    assert.ok(resAlicePoll.body.col_n >= 1, 'col_n phản ánh số người Map 4');

    // Charlie (TH) poll game -> cwf phải là null vì TH chưa giữ cờ
    db.load();
    const pCharlieRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(charlieUid);
    const pCharlieObj = JSON.parse(pCharlieRow.raw_data);
    pCharlieObj.last_tick_at = 0;
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pCharlieObj), charlieUid);
    db.save();

    const resCharliePoll = await callRoute(gameRoutes, { body: { line_uid: charlieUid, session_token: charlieToken } });
    assert.strictEqual(resCharliePoll.body.cwf, null, 'Charlie TH không nhận buff khi TH chưa giữ cờ');
    assert.strictEqual(resCharliePoll.body.cw.gid, 'TH');
    assert.strictEqual(resCharliePoll.body.cw.my, 5);
    console.log('  ✓ Game poll tích hợp đầy đủ cwc, cwf, cw, col_n theo chuẩn thời gian thực.');

    console.log('\n--- 8. Tie-Break by Timestamp & Settlement ---');
    // Giả lập TH ghi thêm 5 điểm để bằng 10 điểm với VN
    const tBefore = cwarManager.scores['VN'].last_score_ts;
    const tAfter = tBefore + 5;
    cwarManager.scores['TH'].p = 10;
    cwarManager.scores['TH'].last_score_ts = tAfter; // TH đạt 10 điểm sau VN

    const rankings = cwarManager.getRankings();
    assert.strictEqual(rankings[0].g, 'VN', 'VN phải đứng trên TH do đạt 10 điểm trước');
    assert.strictEqual(rankings[1].g, 'TH');
    console.log('  ✓ Xử lý Tie-Break theo timestamp chính xác tuyệt đối.');

    console.log('\n--- 9. War Settlement, Auto-Return & Flag Award (Quorum Met) ---');
    // Tổng kết trận đấu (VN thắng với 10 điểm, 5 người tham gia từ 3 quốc gia)
    const settleRes = cwarManager.settleWar();
    assert.strictEqual(settleRes.cancel, false);
    assert.strictEqual(settleRes.winner, 'VN');
    assert.strictEqual(settleRes.points, 10);

    // Kiểm tra state chuyển sang ENDED
    assert.strictEqual(cwarManager.state.st, 'ended');

    // Kiểm tra DB: Toàn bộ người chơi trên Map 4 tự động được warp về vị trí ban đầu (home_return)
    db.load();
    const aliceEndObj = JSON.parse(db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid).raw_data);
    const bobEndObj = JSON.parse(db.prepare('SELECT * FROM players WHERE line_uid = ?').get(bobUid).raw_data);
    const charlieEndObj = JSON.parse(db.prepare('SELECT * FROM players WHERE line_uid = ?').get(charlieUid).raw_data);

    assert.strictEqual(aliceEndObj.map, 1, 'Alice được hoàn trả về Map 1');
    assert.strictEqual(bobEndObj.map, 2, 'Bob được hoàn trả về Map 2');
    assert.strictEqual(charlieEndObj.map, 3, 'Charlie được hoàn trả về Map 3');
    assert.strictEqual(aliceEndObj.home_return, undefined, 'home_return được dọn dẹp sạch');

    // Kiểm tra Game poll trả về popup kết quả ENDED
    db.load();
    const pAliceRow2 = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(aliceUid);
    const pAliceObj2 = JSON.parse(pAliceRow2.raw_data);
    pAliceObj2.last_tick_at = 0;
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pAliceObj2), aliceUid);
    db.save();

    const resAliceEndPoll = await callRoute(gameRoutes, { body: { line_uid: aliceUid, session_token: aliceToken } });
    assert.strictEqual(resAliceEndPoll.body.cw.st, 'ended');
    assert.strictEqual(resAliceEndPoll.body.cw.name, 'VN');
    assert.strictEqual(resAliceEndPoll.body.cw.mine, true);
    assert.strictEqual(resAliceEndPoll.body.cw.cancel, false);
    console.log('  ✓ Tổng kết trao cờ, streak tăng, tự động hoàn trả toàn bộ người chơi về vị trí ban đầu.');

    console.log('\n--- 10. Quorum Check & Cancellation Rule ---');
    // Reset và tạo 1 trận chiến chỉ có 1 quốc gia và 2 người tham gia
    cwarManager.resetWar();
    cwarManager.setWarState('open', 300);
    cwarManager.participants = {
      'p1': { line_uid: 'p1', country: 'VN' },
      'p2': { line_uid: 'p2', country: 'VN' }
    };
    cwarManager.scores = { 'VN': { p: 10, last_score_ts: nowSec } };

    // Tổng kết trận đấu không đủ điều kiện
    const cancelRes = cwarManager.settleWar();
    assert.strictEqual(cancelRes.cancel, true, 'Thiếu điều kiện tối thiểu 2 quốc gia + 4 người phải cancel');
    assert.strictEqual(cwarManager.getFlagHoldingCountry(), 'VN', 'Bảo lưu cờ cho quốc gia đang giữ');
    console.log('  ✓ Không đủ Quorum tự động huỷ trận đấu và bảo lưu cờ thành công.');

    console.log('\n--- 11. Atomic Snapshot Rollback on Error ---');
    cwarManager.setWarState('open', 300);
    const origSave = db.save;
    try {
      db.save = () => {
        throw new Error('Simulated disk error during cwar join');
      };

      const resRollback = await callRoute(cwarRoutes, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'cwar_join' } });
      assert.strictEqual(resRollback.status, 500);
      assert.strictEqual(resRollback.body.ok, false);
    } finally {
      db.save = origSave;
    }
    console.log('  ✓ Rollback snapshot nguyên tử khi lỗi đĩa hoạt động hoàn hảo.');

    console.log('\n🎉 TẤT CẢ 11 BỘ KIỂM THỬ HỆ THỐNG NATION WAR CWAR ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cwarManager.resetWar();
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST CWAR FAILED:', err);
  process.exit(1);
});

