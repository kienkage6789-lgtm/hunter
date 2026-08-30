const assert = require('assert');
const db = require('../server/db/queries');

// Nạp các router
const warpRoute = require('../server/routes/warp');
const marketRoute = require('../server/routes/market');
const premiumRoute = require('../server/routes/premium');
const arenaRoute = require('../server/routes/arena');
const offlineRoute = require('../server/routes/offline');
const vipRoute = require('../server/routes/vip');
const tradeRoute = require('../server/routes/trade');
const guildRoute = require('../server/routes/guild');
const adminRoute = require('../server/routes/admin');

console.log('🧪 Bắt đầu kiểm thử toàn diện Auth Consistency & Admin Security (TASK-025)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_auth_') || uid.startsWith('test_alice_') || uid.startsWith('test_bob_') || uid.startsWith('test_charlie_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.market_listings)) {
        db.data.market_listings = db.data.market_listings.filter(l => !isTestUid(l.seller_uid));
      }
      if (Array.isArray(db.data.market_history)) {
        db.data.market_history = db.data.market_history.filter(h => !isTestUid(h.seller_uid) && !isTestUid(h.buyer_uid));
      }
      if (Array.isArray(db.data.trade_history)) {
        db.data.trade_history = db.data.trade_history.filter(h => !isTestUid(h.u1_uid) && !isTestUid(h.u2_uid));
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
  process.env.ADMIN_API_KEY = 'test_admin_secret_key';

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_auth_alice_' + uniqueSuffix;
  const bobUid = 'test_auth_bob_' + uniqueSuffix;
  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid];

  cleanupTestRecords(testUids);

  try {
    const initialAlice = {
      line_uid: aliceUid,
      name: 'Alice Auth',
      lv: 30,
      gold: 50000,
      p_points: 500,
      map: 1,
      x: 1125,
      y: 1125,
      cards: JSON.stringify({}),
      eggs: JSON.stringify({}),
      arena_won: [],
      offline_zones: []
    };

    const initialBob = {
      line_uid: bobUid,
      name: 'Bob Auth',
      lv: 25,
      gold: 20000,
      p_points: 100,
      map: 1,
      x: 1125,
      y: 1125,
      cards: JSON.stringify({}),
      eggs: JSON.stringify({}),
      arena_won: [],
      offline_zones: []
    };

    // Tạo users & players
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, p_points) VALUES (?, ?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken, 500
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, initialAlice.name, JSON.stringify(initialAlice)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken, 100
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, initialBob.name, JSON.stringify(initialBob)
    );

    console.log('\n========================================');
    console.log('PHẦN A: KIỂM THỬ XÁC THỰC 8 USER ROUTES');
    console.log('========================================');

    const userRoutes = [
      { name: 'warp', router: warpRoute, samplePayload: { target_map: 2 } },
      { name: 'market', router: marketRoute, samplePayload: { action: 'get_listings' } },
      { name: 'premium', router: premiumRoute, samplePayload: { action: 'buy', item: 'exp' } },
      { name: 'arena', router: arenaRoute, samplePayload: { action: 'info' } },
      { name: 'offline', router: offlineRoute, samplePayload: { action: 'preview', map: 1 } },
      { name: 'vip', router: vipRoute, samplePayload: {} },
      { name: 'trade', router: tradeRoute, samplePayload: { action: 'search', q: 'Bob' } },
      { name: 'guild', router: guildRoute, samplePayload: { action: 'info' } }
    ];

    for (const r of userRoutes) {
      console.log(`\n▶ Kiểm tra route /xhrpg_${r.name}.php:`);

      // 1. Thiếu session_token -> Bị chặn
      const resNoToken = await callRoute(r.router, {
        body: { line_uid: aliceUid, ...r.samplePayload }
      });
      assert.strictEqual(resNoToken.body.ok, false, `[${r.name}] Thiếu session_token phải trả về ok: false`);
      assert.ok(
        (resNoToken.body.error || '').toLowerCase().includes('unauthorized') ||
        (resNoToken.body.error || '').toLowerCase().includes('missing'),
        `[${r.name}] Error message phải chỉ ra thiếu token / unauthorized`
      );

      // 2. Token giả mạo -> Bị chặn
      const resFakeToken = await callRoute(r.router, {
        body: { line_uid: aliceUid, session_token: 'fake_token_xyz', ...r.samplePayload }
      });
      assert.strictEqual(resFakeToken.body.ok, false, `[${r.name}] Token giả mạo phải trả về ok: false`);
      assert.ok(
        (resFakeToken.body.error || '').toLowerCase().includes('unauthorized') ||
        (resFakeToken.body.error || '').toLowerCase().includes('invalid'),
        `[${r.name}] Error message phải chỉ ra invalid token / unauthorized`
      );

      // 3. Token của user khác (Alice UID + Bob Token) -> Bị chặn
      const resStolenToken = await callRoute(r.router, {
        body: { line_uid: aliceUid, session_token: bobToken, ...r.samplePayload }
      });
      assert.strictEqual(resStolenToken.body.ok, false, `[${r.name}] Token của user khác phải bị từ chối`);
      assert.ok(
        (resStolenToken.body.error || '').toLowerCase().includes('unauthorized') ||
        (resStolenToken.body.error || '').toLowerCase().includes('invalid'),
        `[${r.name}] Error message phải chỉ ra invalid token / unauthorized`
      );

      // 4. Token đúng -> Được phép truy cập
      const resValidToken = await callRoute(r.router, {
        body: { line_uid: aliceUid, session_token: aliceToken, ...r.samplePayload }
      });
      assert.strictEqual(resValidToken.body.ok, true, `[${r.name}] Token đúng phải được phép truy cập ok: true`);
      console.log(`  ✓ Route ${r.name} xác thực session_token thành công 100%.`);
    }

    console.log('\n========================================');
    console.log('PHẦN B: KIỂM THỬ BẢO MẬT ADMIN API');
    console.log('========================================');

    // 1. Không truyền Header -> Bị từ chối HTTP 401
    const resAdminNoHeader = await callRoute(adminRoute, {
      url: '/give_gold',
      body: { line_uid: aliceUid, amount: 10000 }
    });
    assert.strictEqual(resAdminNoHeader.status, 401, 'Admin request thiếu header phải trả về 401');
    assert.strictEqual(resAdminNoHeader.body.ok, false);

    // 2. Header sai key -> Bị từ chối HTTP 401
    const resAdminWrongHeader = await callRoute(adminRoute, {
      url: '/give_gold',
      headers: { 'x-admin-api-key': 'wrong_admin_key' },
      body: { line_uid: aliceUid, amount: 10000 }
    });
    assert.strictEqual(resAdminWrongHeader.status, 401, 'Admin request sai key phải trả về 401');

    // 3. Header Authorization Bearer sai key -> Bị từ chối HTTP 401
    const resAdminWrongBearer = await callRoute(adminRoute, {
      url: '/give_gold',
      headers: { 'authorization': 'Bearer wrong_admin_key' },
      body: { line_uid: aliceUid, amount: 10000 }
    });
    assert.strictEqual(resAdminWrongBearer.status, 401, 'Admin request sai Bearer key phải trả về 401');

    // 4. Truyền key qua Query String -> BẮT BUỘC BỊ TỪ CHỐI HTTP 401 (chống lộ trong logs/URL)
    const resAdminQueryKey = await callRoute(adminRoute, {
      url: '/give_gold',
      query: { admin_api_key: 'test_admin_secret_key' },
      body: { line_uid: aliceUid, amount: 10000 }
    });
    assert.strictEqual(resAdminQueryKey.status, 401, 'Key truyền qua query string phải bị từ chối 401');
    assert.ok((resAdminQueryKey.body.error || '').includes('prohibited'));

    // 5. Truyền key qua Request Body -> BẮT BUỘC BỊ TỪ CHỐI HTTP 401
    const resAdminBodyKey = await callRoute(adminRoute, {
      url: '/give_gold',
      body: { line_uid: aliceUid, amount: 10000, admin_api_key: 'test_admin_secret_key' }
    });
    assert.strictEqual(resAdminBodyKey.status, 401, 'Key truyền qua request body phải bị từ chối 401');
    assert.ok((resAdminBodyKey.body.error || '').includes('prohibited'));

    // 6. Header x-admin-api-key đúng -> Thành công HTTP 200
    const resAdminValidHeader = await callRoute(adminRoute, {
      url: '/give_gold',
      headers: { 'x-admin-api-key': 'test_admin_secret_key' },
      body: { line_uid: aliceUid, amount: 10000 }
    });
    assert.strictEqual(resAdminValidHeader.status, 200, 'Header x-admin-api-key đúng phải trả về 200');
    assert.strictEqual(resAdminValidHeader.body.ok, true);
    assert.strictEqual(resAdminValidHeader.body.player.gold, 60000);

    // 7. Header Authorization: Bearer <key> đúng -> Thành công HTTP 200
    db.load();
    const pAliceNow = db.data.players.find(p => p.line_uid === aliceUid);
    const pAliceNowObj = JSON.parse(pAliceNow.raw_data);
    const pPointsBefore = pAliceNowObj.p_points || 0;

    const resAdminValidBearer = await callRoute(adminRoute, {
      url: '/give_p',
      headers: { 'authorization': 'Bearer test_admin_secret_key' },
      body: { line_uid: aliceUid, amount: 100 }
    });
    assert.strictEqual(resAdminValidBearer.status, 200, 'Header Authorization Bearer đúng phải trả về 200');
    assert.strictEqual(resAdminValidBearer.body.ok, true);
    assert.strictEqual(resAdminValidBearer.body.player.p_points, pPointsBefore + 100);

    // 8. Admin set_level thành công
    const resAdminSetLevel = await callRoute(adminRoute, {
      url: '/set_level',
      headers: { 'x-admin-api-key': 'test_admin_secret_key' },
      body: { line_uid: aliceUid, level: 50 }
    });
    assert.strictEqual(resAdminSetLevel.status, 200);
    assert.strictEqual(resAdminSetLevel.body.ok, true);
    assert.strictEqual(resAdminSetLevel.body.player.lv, 50);

    console.log('  ✓ Toàn bộ ràng buộc Header-Only Admin API hoạt động chuẩn xác.');

    console.log('\n========================================');
    console.log('PHẦN C: KIỂM THỬ ĐA LUỒNG & ROLLBACK DISK ERROR');
    console.log('========================================');

    // 1. Đa luồng: gọi 2 request give_gold đồng thời
    const [c1, c2] = await Promise.all([
      callRoute(adminRoute, {
        url: '/give_gold',
        headers: { 'x-admin-api-key': 'test_admin_secret_key' },
        body: { line_uid: aliceUid, amount: 5000 }
      }),
      callRoute(adminRoute, {
        url: '/give_gold',
        headers: { 'x-admin-api-key': 'test_admin_secret_key' },
        body: { line_uid: aliceUid, amount: 5000 }
      })
    ]);
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c2.status, 200);
    db.load();
    const pCheck = db.data.players.find(p => p.line_uid === aliceUid);
    const pCheckObj = JSON.parse(pCheck.raw_data);
    assert.strictEqual(pCheckObj.gold, 70000, 'Đa luồng phải cộng dồn chính xác 70,000 Gold');
    console.log('  ✓ An toàn đa luồng dưới acquireLock.');

    // 2. Giả lập lỗi I/O db.save() cho warp và admin mutation
    const originalSave = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk failure'); };

    const resWarpError = await callRoute(warpRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, target_map: 3 }
    });
    assert.strictEqual(resWarpError.body.ok, false, 'Khi save lỗi, warp phải trả về ok: false');

    const resAdminError = await callRoute(adminRoute, {
      url: '/set_level',
      headers: { 'x-admin-api-key': 'test_admin_secret_key' },
      body: { line_uid: aliceUid, level: 99 }
    });
    assert.strictEqual(resAdminError.body.ok, false, 'Khi save lỗi, admin set_level phải trả về ok: false');

    db.save = originalSave;
    db.load();
    const pCheckRollback = db.data.players.find(p => p.line_uid === aliceUid);
    const pCheckRollbackObj = JSON.parse(pCheckRollback.raw_data);
    assert.strictEqual(pCheckRollbackObj.lv, 50, 'Level không được đổi sang 99 khi save lỗi');
    console.log('  ✓ Snapshot rollback nguyên tử khi lỗi đĩa hoạt động hoàn hảo.');

    console.log('\n🎉 TẤT CẢ CÁC BỘ TEST AUTH CONSISTENCY & ADMIN SECURITY ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

