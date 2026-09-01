const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../server/db/queries');

// Nạp các router thật (Implemented Routers)
const logoutRoute = require('../server/routes/logout');
const phistoryRoute = require('../server/routes/phistory');
const homeRoute = require('../server/routes/home');
const pvpRoute = require('../server/routes/pvp');
const raidRoute = require('../server/routes/raid');
const gachaRoute = require('../server/routes/gacha');
const auctionRoute = require('../server/routes/auction');
const orionRaidRoute = require('../server/routes/orion_raid');
const { createUnimplementedRouter } = require('../server/routes/unimplemented');

console.log('🧪 Bắt đầu kiểm thử toàn diện Endpoint Coverage (TASK-038)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_cov_') || uid.startsWith('test_alice_') || uid.startsWith('test_bob_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.topup_history)) {
        db.data.topup_history = db.data.topup_history.filter(h => !isTestUid(h.line_uid));
      }
      if (Array.isArray(db.data.pvp_log)) {
        db.data.pvp_log = db.data.pvp_log.filter(l => !isTestUid(l.winner_uid) && !isTestUid(l.loser_uid));
      }
      if (Array.isArray(db.data.pvp_rank)) {
        db.data.pvp_rank = db.data.pvp_rank.filter(r => !isTestUid(r.winner_uid));
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
    let statusCode = 200;
    const headers = {};
    const req = {
      method: reqOptions.method || 'POST',
      url: reqOptions.url || '/',
      originalUrl: reqOptions.url || '/',
      body: reqOptions.body || {},
      query: reqOptions.query || {},
      headers: Object.assign({ 'content-type': 'application/json' }, reqOptions.headers || {})
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      setHeader: (k, v) => { headers[k] = v; },
      getHeader: (k) => headers[k],
      json: (data) => {
        resolve({ status: statusCode, body: data });
      },
      send: (data) => {
        resolve({ status: statusCode, body: data });
      },
      end: (data) => {
        resolve({ status: statusCode, body: data });
      }
    };
    router.handle(req, res, () => {
      resolve({ status: 404, body: { ok: false, error: 'Route not handled / 404' } });
    });
  });
}

function parseServerRoutes(serverIndexPath) {
  const content = fs.readFileSync(serverIndexPath, 'utf8');
  const implementedRoutes = [];
  const deferred501Routes = [];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('app.use(')) continue;
    const match = trimmed.match(/^app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(.+)\);?$/);
    if (!match) continue;

    const routePath = match[1];
    const handlerExpr = match[2].replace(/;$/, '').trim();

    if (handlerExpr.includes('express.static') || routePath.startsWith('/client') || routePath.startsWith('/js') || routePath.startsWith('/css')) {
      continue;
    }

    if (handlerExpr.includes('createUnimplementedRouter')) {
      const nameMatch = handlerExpr.match(/createUnimplementedRouter\(\s*(['"])(.*?)\1\s*\)/);
      const featureName = nameMatch ? nameMatch[2] : 'Unimplemented';
      deferred501Routes.push({ path: routePath, featureName, handlerExpr });
    } else {
      implementedRoutes.push({ path: routePath, handlerExpr });
    }
  }

  return { implementedRoutes, deferred501Routes };
}

async function runTests() {
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_cov_alice_' + uniqueSuffix;
  const bobUid = 'test_cov_bob_' + uniqueSuffix;
  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid];

  cleanupTestRecords(testUids);

  try {
    const initialAlice = {
      line_uid: aliceUid,
      name: 'Alice Coverage',
      lv: 35,
      house_lv: 5,
      home_lv: 3,
      house_energy: 80,
      house_x: 928,
      house_y: 780,
      home_guards: [{ id: 10, mvp: 0 }],
      country: 'VN'
    };

    const initialBob = {
      line_uid: bobUid,
      name: 'Bob Coverage',
      lv: 40,
      house_lv: 10,
      home_lv: 5,
      house_energy: 100,
      house_x: 928,
      house_y: 780,
      home_guards: [{ id: 20, mvp: 1 }],
      country: 'TH'
    };

    // Tạo users & players
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, p_points) VALUES (?, ?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken, 100
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, initialAlice.name, JSON.stringify(initialAlice)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, p_points) VALUES (?, ?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken, 200
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, initialBob.name, JSON.stringify(initialBob)
    );

    // Thêm bản ghi topup_history test cho Alice
    db.load();
    if (!db.data.topup_history) db.data.topup_history = [];
    db.data.topup_history.push({
      id: 9901,
      line_uid: aliceUid,
      amount: 100,
      p_points: 100,
      currency: 'USD',
      status: 'completed',
      created_at: Math.floor(Date.now() / 1000)
    });
    db.save();

    console.log('\n========================================');
    console.log('PHẦN 1: KIỂM THỬ ROUTER THẬT ĐÃ TRIỂN KHAI (IMPLEMENTED ROUTERS)');
    console.log('========================================');

    // 1.1 Kiểm tra xhrpg_logout.php
    console.log('\n▶ Test 1.1: Kiểm tra xhrpg_logout.php...');
    // Thiếu token -> Bị chặn
    const resLogoutNoTok = await callRoute(logoutRoute, { body: { line_uid: bobUid } });
    assert.strictEqual(resLogoutNoTok.body.ok, false);
    assert.ok(resLogoutNoTok.body.error.includes('Unauthorized'));

    // Token sai -> Bị chặn
    const resLogoutBadTok = await callRoute(logoutRoute, { body: { line_uid: bobUid, session_token: 'fake_token_xyz' } });
    assert.strictEqual(resLogoutBadTok.body.ok, false);
    assert.ok(resLogoutBadTok.body.error.includes('Unauthorized'));

    // Token của user khác (Bob UID + Alice Token) -> Bị chặn
    const resLogoutStolen = await callRoute(logoutRoute, { body: { line_uid: bobUid, session_token: aliceToken } });
    assert.strictEqual(resLogoutStolen.body.ok, false);
    assert.ok(resLogoutStolen.body.error.includes('Unauthorized'));

    // Token đúng -> Đăng xuất và thu hồi session thành công
    const resLogoutValid = await callRoute(logoutRoute, { body: { line_uid: bobUid, session_token: bobToken } });
    assert.strictEqual(resLogoutValid.body.ok, true);
    assert.ok(resLogoutValid.body.msg.includes('Đăng xuất'));

    // Kiểm tra DB: session_token của Bob phải là null
    db.load();
    const bobUser = db.data.users.find(u => u.line_uid === bobUid);
    assert.strictEqual(bobUser.session_token, null, 'session_token của Bob phải bị đặt null sau logout');

    // Thử dùng lại token cũ của Bob sau khi logout -> Bắt buộc bị từ chối Unauthorized
    const resBobPhistoryOldTok = await callRoute(phistoryRoute, { body: { line_uid: bobUid, session_token: bobToken } });
    assert.strictEqual(resBobPhistoryOldTok.body.ok, false, 'Token cũ sau khi logout không được phép truy cập');
    assert.ok(resBobPhistoryOldTok.body.error.includes('Unauthorized'));

    const resBobLogoutOldTok = await callRoute(logoutRoute, { body: { line_uid: bobUid, session_token: bobToken } });
    assert.strictEqual(resBobLogoutOldTok.body.ok, false, 'Logout lại bằng token cũ phải bị từ chối');
    console.log('  ✓ Logout endpoint xác thực và thu hồi session_token an toàn tuyệt đối.');

    // 1.2 Kiểm tra xhrpg_phistory.php
    console.log('\n▶ Test 1.2: Kiểm tra xhrpg_phistory.php...');
    const resPhistNoTok = await callRoute(phistoryRoute, { body: { line_uid: aliceUid } });
    assert.strictEqual(resPhistNoTok.body.ok, false);
    assert.ok(resPhistNoTok.body.error.includes('Unauthorized'));

    const resPhistBadTok = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: 'wrong_tok' } });
    assert.strictEqual(resPhistBadTok.body.ok, false);

    const resPhistStolen = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: bobToken } });
    assert.strictEqual(resPhistStolen.body.ok, false);

    const resPhistValid = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: aliceToken } });
    assert.strictEqual(resPhistValid.body.ok, true);
    assert.ok(Array.isArray(resPhistValid.body.history));
    assert.strictEqual(resPhistValid.body.history.length, 1);
    assert.strictEqual(resPhistValid.body.history[0].id, 9901);
    assert.strictEqual(resPhistValid.body.history[0].p_points, 100);
    console.log('  ✓ phistory endpoint xác thực bảo mật và đọc lịch sử chuẩn xác.');

    // 1.3 Kiểm tra xhrpg_home.php
    console.log('\n▶ Test 1.3: Kiểm tra xhrpg_home.php...');
    const resHomeNoTok = await callRoute(homeRoute, { body: { line_uid: aliceUid, action: 'view', target: bobUid } });
    assert.strictEqual(resHomeNoTok.body.ok, false);

    const resHomeBob = await callRoute(homeRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'view', target: bobUid } });
    assert.strictEqual(resHomeBob.body.ok, true);
    assert.ok(resHomeBob.body.owner, 'Phải có object owner');
    assert.strictEqual(resHomeBob.body.owner.uid, bobUid);
    assert.strictEqual(resHomeBob.body.owner.country, 'TH');
    assert.ok(resHomeBob.body.house, 'Phải có object house');
    assert.strictEqual(resHomeBob.body.house.lv, 10);
    assert.strictEqual(resHomeBob.body.house.home_lv, 5);
    assert.strictEqual(resHomeBob.body.house.guards.length, 1);
    assert.strictEqual(resHomeBob.body.house.guards[0].id, 20);
    console.log('  ✓ home endpoint xác thực và trả về thông tin nhà target chính xác.');

    // 1.4 Kiểm tra xhrpg_pvp.php (Router thật — KHÔNG coi là 501)
    console.log('\n▶ Test 1.4: Kiểm tra xhrpg_pvp.php (Router thật)...');
    // Thiếu auth -> 401 Unauthorized (không phải 501!)
    const resPvpNoAuth = await callRoute(pvpRoute, { body: {} });
    assert.strictEqual(resPvpNoAuth.status, 401, 'PvP thiếu auth phải trả về HTTP 401');
    assert.strictEqual(resPvpNoAuth.body.ok, false);
    assert.ok(resPvpNoAuth.body.error.includes('Unauthorized'));
    assert.notStrictEqual(resPvpNoAuth.status, 501, 'PvP KHÔNG được trả về 501 Not Implemented');

    // Token sai -> 401
    const resPvpBadAuth = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: 'fake_token' } });
    assert.strictEqual(resPvpBadAuth.status, 401);
    assert.strictEqual(resPvpBadAuth.body.ok, false);

    // Token user khác -> 401
    const resPvpStolen = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: bobToken } });
    assert.strictEqual(resPvpStolen.status, 401);
    assert.strictEqual(resPvpStolen.body.ok, false);

    // Action list -> HTTP 200, ok: true, trả về danh sách đối thủ
    const resPvpList = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'list' } });
    assert.strictEqual(resPvpList.status, 200);
    assert.strictEqual(resPvpList.body.ok, true);
    assert.ok(resPvpList.body.pages >= 1, 'PvP list phải có pages >= 1');
    assert.ok(Array.isArray(resPvpList.body.players), 'PvP list phải có mảng players');
    assert.notStrictEqual(resPvpList.status, 501, 'PvP router thật không được trả về 501');

    // Action rank -> HTTP 200, ok: true, mảng rank
    const resPvpRank = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'rank' } });
    assert.strictEqual(resPvpRank.status, 200);
    assert.strictEqual(resPvpRank.body.ok, true);
    assert.ok(Array.isArray(resPvpRank.body.rank), 'PvP rank phải có mảng rank');

    // Action log -> HTTP 200, ok: true, mảng log
    const resPvpLog = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'log' } });
    assert.strictEqual(resPvpLog.status, 200);
    assert.strictEqual(resPvpLog.body.ok, true);
    assert.ok(Array.isArray(resPvpLog.body.log), 'PvP log phải có mảng log');

    // Action pvp_toggle -> HTTP 200, ok: true, pvp_off boolean
    const resPvpToggle = await callRoute(pvpRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'pvp_toggle' } });
    assert.strictEqual(resPvpToggle.status, 200);
    assert.strictEqual(resPvpToggle.body.ok, true);
    assert.strictEqual(typeof resPvpToggle.body.pvp_off, 'boolean');
    console.log('  ✓ PvP endpoint đã kiểm thử router thật, HTTP status & JSON shape hoàn toàn chuẩn xác (không giả lập 501).');

    // 1.5 Kiểm tra xhrpg_raid.php (Router thật — KHÔNG coi là 501)
    console.log('\n▶ Test 1.5: Kiểm tra xhrpg_raid.php (Router thật)...');
    // Thiếu auth -> 401 Unauthorized (không phải 501!)
    const resRaidNoAuth = await callRoute(raidRoute, { body: {} });
    assert.strictEqual(resRaidNoAuth.status, 401, 'Raid thiếu auth phải trả về HTTP 401');
    assert.strictEqual(resRaidNoAuth.body.ok, false);
    assert.ok(resRaidNoAuth.body.error.includes('Unauthorized'));
    assert.notStrictEqual(resRaidNoAuth.status, 501, 'Raid KHÔNG được trả về 501 Not Implemented');

    // Token sai -> 401
    const resRaidBadAuth = await callRoute(raidRoute, { body: { line_uid: aliceUid, session_token: 'fake_token' } });
    assert.strictEqual(resRaidBadAuth.status, 401);
    assert.strictEqual(resRaidBadAuth.body.ok, false);

    // Token user khác -> 401
    const resRaidStolen = await callRoute(raidRoute, { body: { line_uid: aliceUid, session_token: bobToken } });
    assert.strictEqual(resRaidStolen.status, 401);
    assert.strictEqual(resRaidStolen.body.ok, false);

    // Action list -> HTTP 200, ok: true, danh sách targets
    const resRaidList = await callRoute(raidRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'list' } });
    assert.strictEqual(resRaidList.status, 200);
    assert.strictEqual(resRaidList.body.ok, true);
    assert.ok(Array.isArray(resRaidList.body.targets), 'Raid list phải có mảng targets');
    assert.notStrictEqual(resRaidList.status, 501, 'Raid router thật không được trả về 501');

    // Action feed -> HTTP 200, ok: true, mảng feed
    const resRaidFeed = await callRoute(raidRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'feed' } });
    assert.strictEqual(resRaidFeed.status, 200);
    assert.strictEqual(resRaidFeed.body.ok, true);
    assert.ok(Array.isArray(resRaidFeed.body.feed), 'Raid feed phải có mảng feed');

    // Action hist -> HTTP 200, ok: true, mảng hist
    const resRaidHist = await callRoute(raidRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'hist' } });
    assert.strictEqual(resRaidHist.status, 200);
    assert.strictEqual(resRaidHist.body.ok, true);
    assert.strictEqual(resRaidHist.body.me, aliceUid);
    assert.ok(Array.isArray(resRaidHist.body.hist), 'Raid hist phải có mảng hist');
    console.log('  ✓ Raid endpoint đã kiểm thử router thật, HTTP status & JSON shape hoàn toàn chuẩn xác (không giả lập 501).');

    // 1.6 Kiểm tra xhrpg_gacha.php (Router thật — TASK-042)
    console.log('\n▶ Test 1.6: Kiểm tra xhrpg_gacha.php (Router thật)...');
    const resGachaNoAuth = await callRoute(gachaRoute, { body: {} });
    assert.strictEqual(resGachaNoAuth.status, 401, 'Gacha thiếu auth phải trả về HTTP 401');
    assert.strictEqual(resGachaNoAuth.body.ok, false);

    const resGachaInfo = await callRoute(gachaRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'info' } });
    assert.strictEqual(resGachaInfo.status, 200);
    assert.strictEqual(resGachaInfo.body.ok, 1);
    assert.strictEqual(typeof resGachaInfo.body.used, 'number');
    assert.strictEqual(resGachaInfo.body.max, 10);
    assert.strictEqual(typeof resGachaInfo.body.next_cost, 'number');
    console.log('  ✓ Gacha endpoint đã kiểm thử router thật, HTTP status & JSON shape hoàn toàn chuẩn xác (không còn là 501).');

    // 1.8 xhrpg_auction.php
    const resAucNoAuth = await callRoute(auctionRoute, { body: {} });
    assert.strictEqual(resAucNoAuth.status, 401, 'Auction thiếu auth phải trả về HTTP 401');
    assert.strictEqual(resAucNoAuth.body.ok, false);

    const resAucState = await callRoute(auctionRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'state' } });
    assert.strictEqual(resAucState.status, 200);
    assert.strictEqual(resAucState.body.ok, true);
    assert.strictEqual(resAucState.body.slots.length, 6);
    console.log('  ✓ Auction endpoint đã kiểm thử router thật, HTTP status & JSON shape hoàn toàn chuẩn xác (không còn là 501).');

    // 1.9 xhrpg_orion_raid.php
    const resOrionNoAuth = await callRoute(orionRaidRoute, { body: {} });
    assert.strictEqual(resOrionNoAuth.status, 401, 'Orion Raid thiếu auth phải trả về HTTP 401');
    assert.strictEqual(resOrionNoAuth.body.ok, false);

    const resOrionInfo = await callRoute(orionRaidRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'info' } });
    assert.strictEqual(resOrionInfo.status, 200);
    assert.strictEqual(resOrionInfo.body.ok, true);
    assert.strictEqual(resOrionInfo.body.rate, 50);
    console.log('  ✓ Orion Raid endpoint đã kiểm thử router thật, HTTP status & JSON shape hoàn toàn chuẩn xác (không còn là 501).');

    console.log('\n========================================');
    console.log('PHẦN 2: KIỂM THỬ 6 ROUTE BACKLOG CHỦ ĐỘNG TRẢ HTTP 501 (INTENTIONALLY DEFERRED CONTRACT)');
    console.log('========================================');

    // Danh sách 6 route backlog thực tế mounted bằng createUnimplementedRouter trong server/index.js
    // (Đã loại trừ pvp, raid, gacha, auction và orion_raid vì đã có router thật ở Phần 1)
    const intentionallyDeferredList = [
      { name: 'migrate', path: '/xhrpg_migrate.php', feature: 'Migrate Code (Di cư tài khoản)' },
      { name: 'voucher', path: '/xhrpg_voucher.php', feature: 'Voucher (Đổi thẻ quà tặng)' },
      { name: 'stripe_topup', path: '/xhrpg_stripe_topup.php', feature: 'Stripe Topup (Cổng thanh toán Stripe)' },
      { name: 'topup_promo', path: '/xhrpg_topup_promo.php', feature: 'Topup Promo (Khuyến mãi nạp tiền)' },
      { name: 'coda_paycode', path: '/xhrpg_coda_paycode.php', feature: 'CodaPay (Cổng thanh toán CodaPay)' },
      { name: 'xsolla_token', path: '/xhrpg_xsolla_token.php', feature: 'XSolla PayStation (Cổng thanh toán XSolla)' }
    ];

    assert.strictEqual(intentionallyDeferredList.length, 6, 'Phải có chính xác 6 route 501 backlog (loại bỏ pvp, raid, gacha, auction và orion_raid)');

    for (const item of intentionallyDeferredList) {
      const router = createUnimplementedRouter(item.feature);
      const res = await callRoute(router, { body: { line_uid: aliceUid, session_token: aliceToken } });
      assert.strictEqual(res.status, 501, `[${item.name}] Bắt buộc phải trả về HTTP 501 Not Implemented`);
      assert.strictEqual(res.body.ok, false, `[${item.name}] Tuyệt đối không được trả về ok: true (không fake success)`);
      assert.ok(res.body.error, `[${item.name}] Phải có thông báo lỗi rõ ràng`);
      assert.ok(
        res.body.error.includes(item.feature) && res.body.error.includes('hiện chưa được hỗ trợ trên máy chủ'),
        `[${item.name}] Thông báo lỗi phải phản ánh đúng tên tính năng`
      );
      console.log(`  ✓ Endpoint ${item.name} (${item.path}) trả về HTTP 501 Not Implemented an toàn.`);
    }

    console.log('\n========================================');
    console.log('PHẦN 3: KIỂM THỬ ROUTE THIẾU / CHƯA MOUNT TRÊN SERVER (MISSING / UNMOUNTED ENDPOINTS)');
    console.log('========================================');

    // Các endpoint được tham chiếu trong mã nguồn cũ hoặc comment client nhưng không có route trên server
    const unmountedList = [
      { name: 'report', path: '/xhrpg_report.php', reason: 'Form report cũ đã được thay bằng chat DM trực tiếp với Admin' },
      { name: 'config', path: '/xhrpg_config.php', reason: 'File PHP config server cũ, không phải API endpoint' },
      { name: 'nonexistent', path: '/xhrpg_unknown_nonexistent.php', reason: 'Route hoàn toàn không tồn tại' }
    ];

    // Tạo Express App mô phỏng đúng server để kiểm tra hành vi rơi ra 404
    const coverageApp = express();
    coverageApp.use('/xhrpg_pvp.php', pvpRoute);
    coverageApp.use('/xhrpg_raid.php', raidRoute);
    coverageApp.use('/xhrpg_logout.php', logoutRoute);
    coverageApp.use('/xhrpg_phistory.php', phistoryRoute);
    coverageApp.use('/xhrpg_home.php', homeRoute);
    for (const d of intentionallyDeferredList) {
      coverageApp.use(d.path, createUnimplementedRouter(d.feature));
    }

    for (const item of unmountedList) {
      const res = await callRoute(coverageApp, { url: item.path, body: { line_uid: aliceUid, session_token: aliceToken } });
      assert.strictEqual(res.status, 404, `[${item.name}] Endpoint chưa mount (${item.path}) phải trả về HTTP 404`);
      assert.strictEqual(res.body.ok, false, `[${item.name}] Không được trả về ok: true`);
      assert.notStrictEqual(res.status, 501, `[${item.name}] Endpoint unmounted không được nhầm lẫn thành 501`);
      console.log(`  ✓ Endpoint ${item.name} (${item.path}) được xác nhận MISSING/UNMOUNTED (HTTP 404): ${item.reason}`);
    }

    console.log('\n========================================');
    console.log('PHẦN 4: AUDIT ĐỒNG BỘ ROUTE TABLE VỚI SERVER/INDEX.JS');
    console.log('========================================');

    const serverIndexPath = path.join(__dirname, '..', 'server', 'index.js');
    const { implementedRoutes, deferred501Routes } = parseServerRoutes(serverIndexPath);

    console.log(`▶ Tổng số route mount trong server/index.js: ${implementedRoutes.length + deferred501Routes.length}`);
    console.log(`  - Implemented routes: ${implementedRoutes.length}`);
    console.log(`  - Deferred 501 routes: ${deferred501Routes.length}`);

    // Kiểm tra /xhrpg_pvp.php và /xhrpg_raid.php nằm trong implementedRoutes
    const pvpMount = implementedRoutes.find(r => r.path === '/xhrpg_pvp.php');
    assert.ok(pvpMount, '/xhrpg_pvp.php bắt buộc phải được mount trong server/index.js');
    assert.strictEqual(pvpMount.handlerExpr, 'pvpRoutes', '/xhrpg_pvp.php phải gắn với pvpRoutes thật');

    const raidMount = implementedRoutes.find(r => r.path === '/xhrpg_raid.php');
    assert.ok(raidMount, '/xhrpg_raid.php bắt buộc phải được mount trong server/index.js');
    assert.strictEqual(raidMount.handlerExpr, 'raidRoutes', '/xhrpg_raid.php phải gắn với raidRoutes thật');

    const gachaMount = implementedRoutes.find(r => r.path === '/xhrpg_gacha.php');
    assert.ok(gachaMount, '/xhrpg_gacha.php bắt buộc phải được mount trong server/index.js');
    assert.strictEqual(gachaMount.handlerExpr, 'gachaRoutes', '/xhrpg_gacha.php phải gắn với gachaRoutes thật');

    const aucMount = implementedRoutes.find(r => r.path === '/xhrpg_auction.php');
    assert.ok(aucMount, '/xhrpg_auction.php bắt buộc phải được mount trong server/index.js');
    assert.strictEqual(aucMount.handlerExpr, 'auctionRoutes', '/xhrpg_auction.php phải gắn với auctionRoutes thật');

    const orionMount = implementedRoutes.find(r => r.path === '/xhrpg_orion_raid.php');
    assert.ok(orionMount, '/xhrpg_orion_raid.php bắt buộc phải được mount trong server/index.js');
    assert.strictEqual(orionMount.handlerExpr, 'orionRaidRoutes', '/xhrpg_orion_raid.php phải gắn với orionRaidRoutes thật');

    // Kiểm tra không có pvp, raid, gacha, auction hay orion_raid nào trong deferred501Routes
    const pvp501 = deferred501Routes.find(r => r.path === '/xhrpg_pvp.php');
    assert.strictEqual(pvp501, undefined, 'Tuyệt đối không được mount /xhrpg_pvp.php dưới dạng createUnimplementedRouter');

    const raid501 = deferred501Routes.find(r => r.path === '/xhrpg_raid.php');
    assert.strictEqual(raid501, undefined, 'Tuyệt đối không được mount /xhrpg_raid.php dưới dạng createUnimplementedRouter');

    const gacha501 = deferred501Routes.find(r => r.path === '/xhrpg_gacha.php');
    assert.strictEqual(gacha501, undefined, 'Tuyệt đối không được mount /xhrpg_gacha.php dưới dạng createUnimplementedRouter');

    const auc501 = deferred501Routes.find(r => r.path === '/xhrpg_auction.php');
    assert.strictEqual(auc501, undefined, 'Tuyệt đối không được mount /xhrpg_auction.php dưới dạng createUnimplementedRouter');

    const orion501 = deferred501Routes.find(r => r.path === '/xhrpg_orion_raid.php');
    assert.strictEqual(orion501, undefined, 'Tuyệt đối không được mount /xhrpg_orion_raid.php dưới dạng createUnimplementedRouter');

    // Kiểm tra 6 route 501 thực tế khớp chính xác với server/index.js
    assert.strictEqual(deferred501Routes.length, 6, 'server/index.js phải có chính xác 6 route 501');
    for (const d of intentionallyDeferredList) {
      const match = deferred501Routes.find(r => r.path === d.path);
      assert.ok(match, `Route 501 ${d.path} phải tồn tại trong server/index.js`);
      assert.strictEqual(match.featureName, d.feature, `Tên tính năng cho ${d.path} phải khớp`);
    }

    console.log('  ✓ Toàn bộ route mount trong server/index.js đã được đối chiếu và khớp 100% với 3 trạng thái phân loại!');

    console.log('\n🎉 TẤT CẢ CÁC KIỂM TRA ENDPOINT COVERAGE ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
