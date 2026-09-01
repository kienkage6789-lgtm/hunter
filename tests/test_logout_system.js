const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const logoutRoute = require('../server/routes/logout');
const phistoryRoute = require('../server/routes/phistory');
const gameRoute = require('../server/routes/game');
const guildRoute = require('../server/routes/guild');

function callRoute(router, reqOptions) {
  return new Promise((resolve) => {
    const req = {
      method: reqOptions.method || 'POST',
      url: reqOptions.url || '/',
      body: reqOptions.body || {},
      query: reqOptions.query || {},
      headers: reqOptions.headers || {},
      ip: '127.0.0.1'
    };
    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        resolve({ status: statusCode, body: data });
      },
      send: (data) => {
        resolve({ status: statusCode, body: data });
      }
    };
    router.handle(req, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Route not handled' } });
    });
  });
}

function cleanupData() {
  db.load();
  if (db.data) {
    if (Array.isArray(db.data.users)) {
      db.data.users = db.data.users.filter(u => !u.line_uid.startsWith('test_lg_'));
    }
    if (Array.isArray(db.data.players)) {
      db.data.players = db.data.players.filter(p => !p.line_uid.startsWith('test_lg_'));
    }
    db.save();
  }
}

async function runTest() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ HỆ THỐNG LOGOUT TOKEN REVOCATION (TASK-036)');
  console.log('================================================================\n');

  cleanupData();

  const testSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const uidAlice = `test_lg_alice_${testSuffix}`;
  const tokAlice = `tok_alice_${testSuffix}`;
  const uidBob = `test_lg_bob_${testSuffix}`;
  const tokBob = `tok_bob_${testSuffix}`;

  try {
    // =========================================================================
    // TEST 1: CLIENT CONTRACT STATIC ANALYSIS
    // =========================================================================
    console.log('▶ Test 1: Client Contract Static Analysis (xhrpg_canvas.js)...');
    {
      const clientJsPath = path.resolve(__dirname, '../client/xhrpg_canvas.js');
      const clientContent = fs.readFileSync(clientJsPath, 'utf8');

      // 1. Kiểm tra hàm logout() có tồn tại
      assert.ok(clientContent.includes('function logout()'), 'Client phải có hàm logout()');

      // 2. Kiểm tra việc gửi POST xhrpg_logout.php với line_uid và session_token
      assert.ok(clientContent.includes("baseUrl + 'xhrpg_logout.php'"), 'Client phải gọi xhrpg_logout.php');
      assert.ok(clientContent.includes('data: { line_uid: currentUid, session_token: currentToken }'), 'Client phải truyền line_uid và session_token');
      assert.ok(clientContent.includes('timeout: 3000'), 'Client phải có timeout cho request logout');

      // 3. Kiểm tra việc dọn dẹp state và xử lý đa nhánh
      assert.ok(clientContent.includes('sessionToken = null'), 'Client phải clear sessionToken sau khi logout');
      assert.ok(clientContent.includes('player = null'), 'Client phải clear player state');
      assert.ok(clientContent.includes('_chClear()'), 'Client phải clear chat state');
      assert.ok(clientContent.includes('_bmClose()'), 'Client phải đóng panel bot monitor');
      assert.ok(clientContent.includes('liff.logout()'), 'Client phải gọi liff.logout() cho nhánh LIFF');
      assert.ok(clientContent.includes('startDemo(baseUrl)'), 'Client phải gọi startDemo cho nhánh local');

      console.log('  ✓ Client static analysis đạt chuẩn: Multi-branch POST revocation, timeout & fail-safe cleanup.');
    }

    // Thiết lập dữ liệu người chơi trong DB
    db.load();
    db.data.users = db.data.users || [];
    db.data.players = db.data.players || [];

    db.data.users.push(
      { line_uid: uidAlice, username: `u_${uidAlice}`, role: 'user', session_token: tokAlice },
      { line_uid: uidBob, username: `u_${uidBob}`, role: 'user', session_token: tokBob }
    );

    db.data.players.push(
      {
        line_uid: uidAlice,
        name: 'Alice',
        raw_data: JSON.stringify({ line_uid: uidAlice, name: 'Alice', lv: 25, map: 1 })
      },
      {
        line_uid: uidBob,
        name: 'Bob',
        raw_data: JSON.stringify({ line_uid: uidBob, name: 'Bob', lv: 30, map: 1 })
      }
    );
    db.save();

    // =========================================================================
    // TEST 2: SERVER MISSING CREDENTIALS (HTTP 401)
    // =========================================================================
    console.log('\n▶ Test 2: Server Missing Credentials (HTTP 401)...');
    {
      const resNoUid = await callRoute(logoutRoute, { body: { session_token: tokAlice } });
      assert.strictEqual(resNoUid.status, 401, 'Thiếu line_uid phải trả về 401');
      assert.strictEqual(resNoUid.body.ok, false);

      const resNoTok = await callRoute(logoutRoute, { body: { line_uid: uidAlice } });
      assert.strictEqual(resNoTok.status, 401, 'Thiếu session_token phải trả về 401');
      assert.strictEqual(resNoTok.body.ok, false);

      console.log('  ✓ Từ chối HTTP 401 khi thiếu line_uid hoặc session_token.');
    }

    // =========================================================================
    // TEST 3: SERVER INVALID / FAKE SESSION TOKEN (HTTP 401)
    // =========================================================================
    console.log('\n▶ Test 3: Server Invalid Session Token (HTTP 401)...');
    {
      const resBadTok = await callRoute(logoutRoute, { body: { line_uid: uidAlice, session_token: 'fake_token_random_123' } });
      assert.strictEqual(resBadTok.status, 401, 'Sai session_token phải trả về 401');
      assert.strictEqual(resBadTok.body.ok, false);
      assert.match(resBadTok.body.error, /Invalid session_token/);

      console.log('  ✓ Từ chối HTTP 401 khi session_token không hợp lệ.');
    }

    // =========================================================================
    // TEST 4: STOLEN TOKEN (ALICE TOKEN VỚI BOB UID) (HTTP 401)
    // =========================================================================
    console.log('\n▶ Test 4: Stolen / Mismatched Token (HTTP 401)...');
    {
      const resStolen = await callRoute(logoutRoute, { body: { line_uid: uidBob, session_token: tokAlice } });
      assert.strictEqual(resStolen.status, 401, 'Dùng token của user khác phải trả về 401');
      assert.strictEqual(resStolen.body.ok, false);

      console.log('  ✓ Chặn tuyệt đối hành vi giả mạo token chéo tài khoản.');
    }

    // =========================================================================
    // TEST 5: VALID LOGOUT & TOKEN REVOCATION
    // =========================================================================
    console.log('\n▶ Test 5: Valid Logout & Server Token Revocation...');
    {
      const resLogout = await callRoute(logoutRoute, { body: { line_uid: uidAlice, session_token: tokAlice } });
      assert.strictEqual(resLogout.status, 200, 'Đăng xuất hợp lệ phải trả về 200');
      assert.strictEqual(resLogout.body.ok, true);
      assert.strictEqual(resLogout.body.msg, 'Đăng xuất thành công');

      db.load();
      const aliceInDb = db.data.users.find(u => u.line_uid === uidAlice);
      assert.strictEqual(aliceInDb.session_token, null, 'session_token của Alice phải bị đặt null trong database');

      console.log('  ✓ Đăng xuất thành công và thu hồi session_token về null trong DB.');
    }

    // =========================================================================
    // TEST 6: REVOKED TOKEN REJECTION ON OTHER ENDPOINTS (GAME, PHISTORY, GUILD)
    // =========================================================================
    console.log('\n▶ Test 6: Revoked Token Rejection on other endpoints...');
    {
      // 1. Thử gọi /xhrpg_game.php bằng token cũ của Alice
      const resGame = await callRoute(gameRoute, { body: { line_uid: uidAlice, session_token: tokAlice, action: 'poll' } });
      assert.strictEqual(resGame.body.ok, false, 'Game poll phải từ chối token đã thu hồi');

      // 2. Thử gọi /xhrpg_phistory.php bằng token cũ của Alice
      const resPhist = await callRoute(phistoryRoute, { body: { line_uid: uidAlice, session_token: tokAlice } });
      assert.strictEqual(resPhist.body.ok, false, 'PHistory phải từ chối token đã thu hồi');

      // 3. Thử gọi /xhrpg_guild.php bằng token cũ của Alice
      const resGuild = await callRoute(guildRoute, { body: { line_uid: uidAlice, session_token: tokAlice, action: 'my' } });
      assert.strictEqual(resGuild.body.ok, false, 'Guild route phải từ chối token đã thu hồi');

      console.log('  ✓ Tất cả các endpoint game/phistory/guild đều chặn 100% token đã bị thu hồi.');
    }

    // =========================================================================
    // TEST 7: REPEAT LOGOUT REJECTION (IDEMPOTENT SAFE)
    // =========================================================================
    console.log('\n▶ Test 7: Repeat Logout Rejection with Revoked Token (HTTP 401)...');
    {
      const resRepeat = await callRoute(logoutRoute, { body: { line_uid: uidAlice, session_token: tokAlice } });
      assert.strictEqual(resRepeat.status, 401, 'Gọi lại logout với token đã thu hồi phải bị từ chối 401');
      assert.strictEqual(resRepeat.body.ok, false);

      console.log('  ✓ Chống replay request đăng xuất với token đã chết.');
    }

    // =========================================================================
    // TEST 8: ATOMIC ROLLBACK ON DISK ERROR
    // =========================================================================
    console.log('\n▶ Test 8: Atomic Rollback on Disk Error...');
    {
      const originalSave = db.save;
      try {
        db.save = () => {
          throw new Error('Simulated disk failure during logout');
        };

        const resFail = await callRoute(logoutRoute, { body: { line_uid: uidBob, session_token: tokBob } });
        assert.strictEqual(resFail.status, 500, 'Lỗi đĩa phải trả về 500');
        assert.strictEqual(resFail.body.ok, false);
      } finally {
        db.save = originalSave;
      }

      db.load();
      const bobInDb = db.data.users.find(u => u.line_uid === uidBob);
      assert.strictEqual(bobInDb.session_token, tokBob, 'session_token của Bob phải được bảo toàn nguyên vẹn sau khi rollback');

      console.log('  ✓ Snapshot rollback nguyên tử khôi phục phiên người dùng khi lỗi đĩa.');
    }

    console.log('\n🎉 TẤT CẢ 8 BỘ KIỂM THỬ HỆ THỐNG LOGOUT TOKEN REVOCATION ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupData();
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!\n');
  }
}

runTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
