const assert = require('assert');
const db = require('../server/db/queries');

// Nạp các router Phase A
const logoutRoute = require('../server/routes/logout');
const phistoryRoute = require('../server/routes/phistory');
const homeRoute = require('../server/routes/home');
const { createUnimplementedRouter } = require('../server/routes/unimplemented');

console.log('🧪 Bắt đầu kiểm thử toàn diện Endpoint Coverage (TASK-026)...');

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
    console.log('PHẦN 1: KIỂM THỬ 3 ROUTE PHASE A');
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
    // Thiếu token -> Unauthorized
    const resPhistNoTok = await callRoute(phistoryRoute, { body: { line_uid: aliceUid } });
    assert.strictEqual(resPhistNoTok.body.ok, false);
    assert.ok(resPhistNoTok.body.error.includes('Unauthorized'));

    // Token sai -> Unauthorized
    const resPhistBadTok = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: 'wrong_tok' } });
    assert.strictEqual(resPhistBadTok.body.ok, false);

    // Token user khác -> Unauthorized
    const resPhistStolen = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: bobToken } });
    assert.strictEqual(resPhistStolen.body.ok, false);

    // Token đúng -> Trả về đúng lịch sử giao dịch của Alice
    const resPhistValid = await callRoute(phistoryRoute, { body: { line_uid: aliceUid, session_token: aliceToken } });
    assert.strictEqual(resPhistValid.body.ok, true);
    assert.ok(Array.isArray(resPhistValid.body.history));
    assert.strictEqual(resPhistValid.body.history.length, 1);
    assert.strictEqual(resPhistValid.body.history[0].id, 9901);
    assert.strictEqual(resPhistValid.body.history[0].p_points, 100);
    console.log('  ✓ phistory endpoint xác thực bảo mật và đọc lịch sử chuẩn xác.');

    // 1.3 Kiểm tra xhrpg_home.php
    console.log('\n▶ Test 1.3: Kiểm tra xhrpg_home.php...');
    // Thiếu token -> Unauthorized
    const resHomeNoTok = await callRoute(homeRoute, { body: { line_uid: aliceUid, action: 'view', target: bobUid } });
    assert.strictEqual(resHomeNoTok.body.ok, false);

    // Token đúng xem nhà của Bob
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

    console.log('\n========================================');
    console.log('PHẦN 2: KIỂM THỬ 11 ROUTE BACKLOG (HTTP 501 CONTRACT)');
    console.log('========================================');

    const unimplementedList = [
      { name: 'gacha', router: createUnimplementedRouter('Gacha') },
      { name: 'pvp', router: createUnimplementedRouter('PvP') },
      { name: 'raid', router: createUnimplementedRouter('Raid') },
      { name: 'orion_raid', router: createUnimplementedRouter('Orion Raid') },
      { name: 'auction', router: createUnimplementedRouter('Auction') },
      { name: 'migrate', router: createUnimplementedRouter('Migrate') },
      { name: 'voucher', router: createUnimplementedRouter('Voucher') },
      { name: 'stripe_topup', router: createUnimplementedRouter('Stripe Topup') },
      { name: 'topup_promo', router: createUnimplementedRouter('Topup Promo') },
      { name: 'coda_paycode', router: createUnimplementedRouter('CodaPay') },
      { name: 'xsolla_token', router: createUnimplementedRouter('XSolla PayStation') }
    ];

    for (const item of unimplementedList) {
      const res = await callRoute(item.router, { body: { line_uid: aliceUid, session_token: aliceToken } });
      assert.strictEqual(res.status, 501, `[${item.name}] Bắt buộc phải trả về HTTP 501 Not Implemented`);
      assert.strictEqual(res.body.ok, false, `[${item.name}] Không được trả về ok: true`);
      assert.ok(res.body.error, `[${item.name}] Phải có thông báo lỗi rõ ràng`);
      console.log(`  ✓ Endpoint ${item.name} trả về HTTP 501 Not Implemented an toàn.`);
    }

    console.log('\n🎉 TẤT CẢ CÁC ENDPOINT TRONG TEST COVERAGE ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

