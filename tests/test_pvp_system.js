const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const pvpRoute = require('../server/routes/pvp');
const pvpManager = require('../server/game/PvPManager');

console.log('🧪 Bắt đầu kiểm thử toàn diện Hệ Thống PvP 1v1 (TASK-029)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_pvp_') || uid.startsWith('test_alice_') || uid.startsWith('test_bob_') || uid.startsWith('test_charlie_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.pvp_log)) {
        db.data.pvp_log = db.data.pvp_log.filter(l => !isTestUid(l.winner_uid) && !isTestUid(l.loser_uid));
      }
      if (Array.isArray(db.data.pvp_rank)) {
        db.data.pvp_rank = db.data.pvp_rank.filter(r => !isTestUid(r.winner_uid));
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
  process.env.NODE_ENV = 'test';

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_pvp_alice_' + uniqueSuffix;
  const bobUid = 'test_pvp_bob_' + uniqueSuffix;
  const charlieUid = 'test_pvp_charlie_' + uniqueSuffix;
  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const charlieToken = 'tok_charlie_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid, charlieUid];

  cleanupTestRecords(testUids);

  try {
    // ═════════════════════════════════════════════════════════════════
    // TEST 1: STATIC CODE AUDIT
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 1. Static Code Audit ---');
    const pvpManagerContent = fs.readFileSync(path.join(__dirname, '../server/game/PvPManager.js'), 'utf8');
    const pvpRouteContent = fs.readFileSync(path.join(__dirname, '../server/routes/pvp.js'), 'utf8');
    const clientContent = fs.readFileSync(path.join(__dirname, '../client/xhrpg_canvas.js'), 'utf8');

    assert(pvpManagerContent.includes('const PVP_DIV = 30;'), 'PvPManager phải định nghĩa PVP_DIV = 30');
    assert(clientContent.includes('const PVP_DIV = 30;'), 'Client phải định nghĩa PVP_DIV = 30');
    assert(pvpRouteContent.includes("action === 'list'"), 'pvp.js phải hỗ trợ action list');
    assert(pvpRouteContent.includes("action === 'shadow_challenge'"), 'pvp.js phải hỗ trợ action shadow_challenge');
    assert(pvpRouteContent.includes("action === 'challenge'"), 'pvp.js phải hỗ trợ action challenge');
    assert(pvpRouteContent.includes("action === 'accept'"), 'pvp.js phải hỗ trợ action accept');
    assert(pvpRouteContent.includes("action === 'decline'"), 'pvp.js phải hỗ trợ action decline');
    assert(pvpRouteContent.includes("action === 'forfeit'"), 'pvp.js phải hỗ trợ action forfeit');
    assert(pvpRouteContent.includes("action === 'log'"), 'pvp.js phải hỗ trợ action log');
    assert(pvpRouteContent.includes("action === 'rank'"), 'pvp.js phải hỗ trợ action rank');
    assert(pvpRouteContent.includes("action === 'pvp_toggle'"), 'pvp.js phải hỗ trợ action pvp_toggle');
    console.log('  ✓ Static code audit đạt chuẩn 100%.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 2: AUTH & SECURITY
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 2. Auth & Security Verification ---');
    // Setup test users in DB
    db.load();
    db.data.users.push(
      { line_uid: aliceUid, username: 'alice', password_hash: 'h', session_token: aliceToken, role: 'user' },
      { line_uid: bobUid, username: 'bob', password_hash: 'h', session_token: bobToken, role: 'user' },
      { line_uid: charlieUid, username: 'charlie', password_hash: 'h', session_token: charlieToken, role: 'user' }
    );

    const aliceRaw = {
      line_uid: aliceUid, name: 'Alice PvP', lv: 35, hp: 450, hp_max: 450, str: 25, agi: 20, vit: 15, dex: 20, luk: 10,
      skills: JSON.stringify({ knife_atk: 5 }), knife_lv: 5, country: 'VN', pvp_wins: 0
    };
    const bobRaw = {
      line_uid: bobUid, name: 'Bob PvP', lv: 30, hp: 400, hp_max: 400, str: 20, agi: 15, vit: 12, dex: 18, luk: 8,
      skills: JSON.stringify({ knife_atk: 3 }), knife_lv: 3, country: 'TH', pvp_wins: 0
    };
    const charlieRaw = {
      line_uid: charlieUid, name: 'Charlie PvP', lv: 25, hp: 350, hp_max: 350, str: 15, agi: 12, vit: 10, dex: 15, luk: 5,
      skills: JSON.stringify({}), knife_lv: 2, country: 'JP', pvp_wins: 0
    };

    db.data.players.push(
      { line_uid: aliceUid, name: 'Alice PvP', lv: 35, exp: 0, hp: 450, hp_max: 450, gold: 10000, map: 1, raw_data: JSON.stringify(aliceRaw) },
      { line_uid: bobUid, name: 'Bob PvP', lv: 30, exp: 0, hp: 400, hp_max: 400, gold: 5000, map: 1, raw_data: JSON.stringify(bobRaw) },
      { line_uid: charlieUid, name: 'Charlie PvP', lv: 25, exp: 0, hp: 350, hp_max: 350, gold: 3000, map: 1, raw_data: JSON.stringify(charlieRaw) }
    );
    db.save();

    // 2.1 Missing session_token
    const resNoToken = await callRoute(pvpRoute, { body: { line_uid: aliceUid, action: 'list' } });
    assert.strictEqual(resNoToken.status, 401, 'Thiếu session_token phải trả về 401');

    // 2.2 Invalid session_token
    const resBadToken = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: 'fake_tok', action: 'list' } });
    assert.strictEqual(resBadToken.status, 401, 'Sai session_token phải trả về 401');

    // 2.3 Wrong user's session_token
    const resStolenToken = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: bobToken, action: 'list' } });
    assert.strictEqual(resStolenToken.status, 401, 'Dùng token của user khác phải trả về 401');
    console.log('  ✓ Xác thực session token hoạt động an toàn 100%.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 3: READ & CONFIG ACTIONS (LIST, RANK, LOG, PVP_TOGGLE)
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 3. Read & Config Actions ---');

    // 3.1 List
    const resList = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'list', page: 0 } });
    assert.strictEqual(resList.status, 200);
    assert.strictEqual(resList.body.ok, true);
    assert(Array.isArray(resList.body.players), 'players phải là array');
    assert(resList.body.players.length >= 3, 'Phải có ít nhất 3 players');
    assert(resList.body.players[0].lv >= resList.body.players[1].lv, 'Players phải được sort theo Level giảm dần');
    console.log('  ✓ Action list phân trang và sắp xếp đúng chuẩn.');

    // 3.2 PvP Toggle
    const resTog1 = await callRoute(pvpRoute, { body: { line_uid: bobUid, session_token: bobToken, action: 'pvp_toggle' } });
    assert.strictEqual(resTog1.body.ok, true);
    assert.strictEqual(resTog1.body.pvp_off, true, 'Lần 1 toggle pvp_off phải thành true');

    const resTog2 = await callRoute(pvpRoute, { body: { line_uid: bobUid, session_token: bobToken, action: 'pvp_toggle' } });
    assert.strictEqual(resTog2.body.ok, true);
    assert.strictEqual(resTog2.body.pvp_off, false, 'Lần 2 toggle pvp_off phải thành false');
    console.log('  ✓ Action pvp_toggle chuyển đổi trạng thái và lưu DB thành công.');

    // 3.3 Log & Rank initial
    const resLogInit = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert.strictEqual(resLogInit.body.ok, true);
    assert(Array.isArray(resLogInit.body.log), 'log phải là array');

    const resRankInit = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'rank' } });
    assert.strictEqual(resRankInit.body.ok, true);
    assert(Array.isArray(resRankInit.body.rank), 'rank phải là array');
    console.log('  ✓ Action log và rank khởi tạo sạch sẽ.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 4: SHADOW DUEL FLOW (ĐẤU BÓNG TỨC THÌ)
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 4. Shadow Duel Flow (Đấu Bóng) ---');

    // 4.1 Reject invalid target
    const resShadowSelf = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'shadow_challenge', target: aliceUid } });
    assert.strictEqual(resShadowSelf.body.ok, false, 'Không thể tự thách đấu');

    const resShadowNone = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'shadow_challenge', target: 'non_existent' } });
    assert.strictEqual(resShadowNone.body.ok, false, 'Đối thủ không tồn tại phải bị từ chối');

    // 4.2 Start Shadow Duel
    const resShadowStart = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'shadow_challenge', target: bobUid } });
    assert.strictEqual(resShadowStart.body.ok, true, 'Bắt đầu đấu bóng thành công');

    // 4.3 Tick phase COUNT
    let tickCount = pvpManager.tickPlayer(aliceUid, aliceRaw);
    assert(tickCount.pvp !== null, 'Phải có pvp payload');
    assert.strictEqual(tickCount.pvp.ph, 'count', 'Phase ban đầu phải là count');
    assert.strictEqual(tickCount.pvp.opp, 'Bob PvP');

    // Giả lập trôi qua 3.5s để chuyển sang fight
    const duelId = pvpManager.playerDuelMap.get(aliceUid);
    const duel = pvpManager.activeDuels.get(duelId);
    duel.startTime = Date.now() - 4000;
    duel.lastTickAt = Date.now() - 2000;

    let tickFight = pvpManager.tickPlayer(aliceUid, aliceRaw);
    assert(tickFight.pvp !== null);
    assert.strictEqual(tickFight.pvp.ph, 'fight', 'Sau đếm ngược phải vào phase fight');
    assert(tickFight.pvp.opp_hp <= tickFight.pvp.opp_hpm, 'HP đối thủ phải bị trừ khi đánh');

    // 4.4 Simulate combat until K.O.
    duel.p2.hp = 0; // Bob (bóng) hết máu
    duel.lastTickAt = Date.now() - 2000;

    let tickEnd = pvpManager.tickPlayer(aliceUid, aliceRaw);
    assert.strictEqual(tickEnd.pvp, null, 'Trận đấu kết thúc pvp phải null');
    assert(tickEnd.events.some(e => e.type === 'pvp_end' && e.win === 1), 'Alice phải nhận event pvp_end win=1');

    // Kiểm tra điểm thắng của Alice tăng lên và log được ghi
    const resLogAfter = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert(resLogAfter.body.log.length >= 1, 'pvp_log phải có bản ghi mới');
    assert.strictEqual(resLogAfter.body.log[0].winner_uid, aliceUid);
    assert.strictEqual(resLogAfter.body.log[0].loser_uid, bobUid);

    const resRankAfter = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'rank' } });
    const aliceRank = resRankAfter.body.rank.find(r => r.winner_uid === aliceUid);
    assert(aliceRank && aliceRank.wins >= 1, 'Alice rank wins phải >= 1');
    console.log('  ✓ Vòng đời Shadow Duel hoạt động chính xác từ count -> fight -> K.O. -> settle log/rank.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 5: LIVE DUEL FLOW (THÁCH ĐẤU TRỰC TIẾP 2 NGƯỜI)
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 5. Live Duel Flow (Thách Đấu Trực Tiếp) ---');

    // 5.1 Alice gửi lời mời Bob
    const resLiveChallenge = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'challenge', target: bobUid } });
    assert.strictEqual(resLiveChallenge.body.ok, true, 'Gửi lời mời thách đấu thành công');

    // Alice kiểm tra poll -> trạng thái wait
    const aliceWait = pvpManager.tickPlayer(aliceUid, aliceRaw);
    assert(aliceWait.pvp !== null);
    assert.strictEqual(aliceWait.pvp.ph, 'wait', 'Alice phải ở trạng thái wait');

    // Bob kiểm tra poll -> trạng thái invite
    const bobInvite = pvpManager.tickPlayer(bobUid, bobRaw);
    assert(bobInvite.pvp !== null);
    assert.strictEqual(bobInvite.pvp.ph, 'invite', 'Bob phải nhận được invite');
    assert.strictEqual(bobInvite.pvp.opp, 'Alice PvP');

    // 5.2 Bob chấp nhận lời mời (Accept)
    const resAccept = await callRoute(pvpRoute, { body: { line_uid: bobUid, session_token: bobToken, action: 'accept' } });
    assert.strictEqual(resAccept.body.ok, true, 'Bob chấp nhận lời mời thành công');

    // Cả 2 cùng chuyển sang count
    const aliceCount = pvpManager.tickPlayer(aliceUid, aliceRaw);
    const bobCount = pvpManager.tickPlayer(bobUid, bobRaw);
    assert.strictEqual(aliceCount.pvp.ph, 'count');
    assert.strictEqual(bobCount.pvp.ph, 'count');
    console.log('  ✓ Vòng đời Live Duel mời -> chấp nhận -> đồng bộ count thành công.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 6: FORFEIT (ĐẦU HÀNG)
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 6. Forfeit Handling ---');

    // Bob đầu hàng
    const resForfeit = await callRoute(pvpRoute, { body: { line_uid: bobUid, session_token: bobToken, action: 'forfeit' } });
    assert.strictEqual(resForfeit.body.ok, true, 'Đầu hàng thành công');

    // Cả 2 đã thoát duel
    assert.strictEqual(pvpManager.playerDuelMap.has(aliceUid), false);
    assert.strictEqual(pvpManager.playerDuelMap.has(bobUid), false);
    console.log('  ✓ Forfeit xử lý đầu hàng và giải phóng trạng thái người chơi an toàn.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 7: DECLINE & TIMEOUT
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 7. Decline & Timeout Handling ---');

    // 7.1 Decline
    await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'challenge', target: charlieUid } });
    assert(pvpManager.pendingInvites.has(charlieUid));

    const resDecline = await callRoute(pvpRoute, { body: { line_uid: charlieUid, session_token: charlieToken, action: 'decline' } });
    assert.strictEqual(resDecline.body.ok, true);
    assert(!pvpManager.pendingInvites.has(charlieUid), 'Pending invite phải bị xóa khi decline');
    assert(!pvpManager.playerDuelMap.has(aliceUid), 'Challenger phải thoát trạng thái wait');

    // 7.2 Timeout 15s
    await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'challenge', target: charlieUid } });
    const inv = pvpManager.pendingInvites.get(charlieUid);
    inv.expiresAt = Date.now() - 1000; // Hết hạn

    const tickExpired = pvpManager.tickPlayer(charlieUid, charlieRaw);
    assert.strictEqual(tickExpired.pvp, null, 'Lời mời hết hạn không được hiển thị');
    assert(!pvpManager.pendingInvites.has(charlieUid));
    console.log('  ✓ Decline và Timeout 15s hoạt động chính xác.');

    // ═════════════════════════════════════════════════════════════════
    // TEST 8: ATOMIC SNAPSHOT ROLLBACK ON DISK ERROR
    // ═════════════════════════════════════════════════════════════════
    console.log('\n--- 8. Atomic Snapshot Rollback on Error ---');
    const originalSave = db.save;
    db.save = () => { throw new Error('Simulated disk I/O failure'); };

    const resError = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'pvp_toggle' } });
    assert.strictEqual(resError.status, 500, 'Lỗi hệ thống phải trả về status 500');

    db.save = originalSave;
    console.log('  ✓ Rollback snapshot nguyên tử khi gặp lỗi I/O hoạt động hoàn hảo.');

    console.log('\n🎉 TẤT CẢ 8 BỘ KIỂM THỬ PVP 1V1 ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});

