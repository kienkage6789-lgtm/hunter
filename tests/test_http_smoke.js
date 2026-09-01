const assert = require('assert');
const app = require('../server/index');
const db = require('../server/db/queries');

console.log('🧪 Bắt đầu kiểm thử HTTP Integration Smoke Test (TASK-039)...');

async function runHttpSmokeTest() {
  let server;
  let baseUrl;

  // 1. Khởi động HTTP server trên port ngẫu nhiên (ephemeral port 0 do OS cấp)
  await new Promise((resolve, reject) => {
    try {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`📡 Express HTTP Server đã khởi động an toàn tại: ${baseUrl}`);
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const username = 'smoke_user_' + uniqueSuffix;
  const password = 'smoke_pass_' + uniqueSuffix;
  let registeredUid = null;
  let validToken = null;

  async function postJson(endpoint, body = {}, headers = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, headers: res.headers, body: data };
  }

  function cleanupDatabase(uids = []) {
    try {
      db.load();
      if (db.data) {
        const isTarget = (uid) => {
          if (!uid) return false;
          if (uids.includes(uid)) return true;
          return uid.startsWith('smoke_') || uid.startsWith('local_smoke_');
        };

        if (Array.isArray(db.data.users)) {
          db.data.users = db.data.users.filter(u => !isTarget(u.line_uid) && !isTarget(u.username));
        }
        if (Array.isArray(db.data.players)) {
          db.data.players = db.data.players.filter(p => !isTarget(p.line_uid) && !isTarget(p.name));
        }
        db.save();
      }
    } catch (err) {
      console.error('Lỗi khi cleanup database:', err);
    }
  }

  try {
    console.log('\n========================================');
    console.log('CRITICAL FLOW 1 & 2: REGISTER, LOGIN VÀ NHẬN SESSION TOKEN');
    console.log('========================================');

    // 1.1 Register
    console.log('▶ Bước 1.1: Đăng ký tài khoản mới qua HTTP POST /api/register...');
    const regRes = await postJson('/api/register', { username, password });
    assert.strictEqual(regRes.status, 200, 'HTTP status đăng ký phải là 200');
    assert.strictEqual(regRes.body.ok, true, 'Đăng ký phải thành công (ok: true)');
    assert.ok(typeof regRes.body.line_uid === 'string' && regRes.body.line_uid.length > 0, 'Phải nhận được line_uid');
    assert.ok(typeof regRes.body.session_token === 'string' && regRes.body.session_token.length > 0, 'Phải nhận được session_token');

    registeredUid = regRes.body.line_uid;
    validToken = regRes.body.session_token;
    console.log(`  ✓ Đăng ký thành công: line_uid=${registeredUid}`);

    // 1.2 Login lại để xác thực luồng đăng nhập
    console.log('▶ Bước 1.2: Đăng nhập lại tài khoản qua HTTP POST /api/login...');
    const loginRes = await postJson('/api/login', { username, password });
    assert.strictEqual(loginRes.status, 200, 'HTTP status đăng nhập phải là 200');
    assert.strictEqual(loginRes.body.ok, true, 'Đăng nhập phải thành công');
    assert.strictEqual(loginRes.body.line_uid, registeredUid);
    assert.ok(typeof loginRes.body.session_token === 'string' && loginRes.body.session_token.length > 0);

    // Cập nhật token hoạt động mới nhất sau login
    validToken = loginRes.body.session_token;
    console.log(`  ✓ Đăng nhập thành công, session_token mới được cấp phát an toàn.`);

    console.log('\n========================================');
    console.log('CRITICAL FLOW 3: GỌI /xhrpg_game.php (MAIN GAME SNAPSHOT)');
    console.log('========================================');

    console.log('▶ Bước 3: Gửi request game snapshot qua HTTP POST /xhrpg_game.php...');
    const gameRes = await postJson('/xhrpg_game.php', {
      line_uid: registeredUid,
      session_token: validToken
    });
    assert.strictEqual(gameRes.status, 200, 'Game endpoint phải trả HTTP 200');
    assert.ok(gameRes.body && (gameRes.body.ok === 1 || gameRes.body.ok === true), 'Game snapshot phải có ok: 1 hoặc ok: true');
    assert.ok(gameRes.body.player, 'Game snapshot phải chứa object player');
    assert.strictEqual(gameRes.body.player.line_uid, registeredUid);
    assert.strictEqual(gameRes.body.player.lv, 1);
    assert.ok(Array.isArray(gameRes.body.monsters), 'Game snapshot phải có mảng monsters');
    console.log('  ✓ /xhrpg_game.php trả về đúng game snapshot hợp lệ cho player mới.');

    console.log('\n========================================');
    console.log('CRITICAL FLOW 4: NÂNG CẤP HỢP LỆ (UPGRADE ACTION)');
    console.log('========================================');

    console.log('▶ Bước 4: Thực hiện nâng chỉ số STR qua HTTP POST /xhrpg_upgrade.php...');
    const initialStr = gameRes.body.player.str || 5;
    const upgRes = await postJson('/xhrpg_upgrade.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'stat_up',
      param: 'str',
      amount: 1
    });
    assert.strictEqual(upgRes.status, 200, 'Upgrade endpoint phải trả HTTP 200');
    assert.strictEqual(upgRes.body.ok, true, 'Upgrade phải thành công (ok: true)');
    assert.ok(upgRes.body.msg && upgRes.body.msg.includes('STR'), 'Phải có thông báo cộng STR');
    assert.ok(upgRes.body.player, 'Response phải trả về player đã cập nhật');
    assert.strictEqual(upgRes.body.player.str, initialStr + 1, 'Chỉ số STR phải tăng thêm 1');
    console.log(`  ✓ Nâng cấp chỉ số STR thành công (${initialStr} -> ${upgRes.body.player.str}).`);

    console.log('\n========================================');
    console.log('CRITICAL FLOW 5: DỊCH CHUYỂN MAP HỢP LỆ VÀ BỊ CHẶN LEVEL');
    console.log('========================================');

    // 5.1 Warp hợp lệ: vào Nhà (Map 5 - yêu cầu Lv 1)
    console.log('▶ Bước 5.1: Dịch chuyển tới Map 5 (Nhà - yêu cầu Lv 1)...');
    const warpValid = await postJson('/xhrpg_warp.php', {
      line_uid: registeredUid,
      session_token: validToken,
      target_map: 5
    });
    assert.strictEqual(warpValid.status, 200, 'Warp hợp lệ phải trả HTTP 200');
    assert.strictEqual(warpValid.body.ok, true, 'Warp hợp lệ phải thành công');
    assert.strictEqual(warpValid.body.map, 5, 'Map ID sau warp phải là 5');
    console.log('  ✓ Dịch chuyển tới Map 5 thành công.');

    // 5.2 Warp không đủ level: tới Sa mạc (Map 2 - yêu cầu Lv 25)
    console.log('▶ Bước 5.2: Dịch chuyển tới Map 2 (Sa mạc - yêu cầu Lv 25) khi nhân vật Lv 1...');
    const warpLocked = await postJson('/xhrpg_warp.php', {
      line_uid: registeredUid,
      session_token: validToken,
      target_map: 2
    });
    assert.strictEqual(warpLocked.status, 200, 'Warp endpoint phản hồi HTTP 200');
    assert.strictEqual(warpLocked.body.ok, false, 'Warp không đủ cấp không được trả ok: true');
    assert.strictEqual(warpLocked.body.error, 'level_locked', 'Mã lỗi phải là level_locked');
    assert.strictEqual(warpLocked.body.need, 25, 'Level yêu cầu phải là 25');
    console.log('  ✓ Server chặn warp vào Sa mạc chuẩn xác: level_locked (cần Lv 25).');

    console.log('\n========================================');
    console.log('CRITICAL FLOW 6: MARKET VÀ CHAT REQUESTS');
    console.log('========================================');

    // 6.1 Market listings
    console.log('▶ Bước 6.1: Đọc danh sách chợ qua HTTP POST /xhrpg_market.php...');
    const marketRes = await postJson('/xhrpg_market.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'get_listings'
    });
    assert.strictEqual(marketRes.status, 200, 'Market endpoint phải trả HTTP 200');
    assert.strictEqual(marketRes.body.ok, true, 'Lấy danh sách chợ phải thành công');
    assert.ok(Array.isArray(marketRes.body.listings), 'Response phải có mảng listings');
    console.log(`  ✓ Market trả về danh sách sản phẩm thành công (${marketRes.body.listings.length} listings).`);

    // 6.2 Chat fetch
    console.log('▶ Bước 6.2: Đọc kênh chat toàn cầu qua HTTP POST /xhrpg_chat.php...');
    const chatRes = await postJson('/xhrpg_chat.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'fetch',
      room: 'global'
    });
    assert.strictEqual(chatRes.status, 200, 'Chat endpoint phải trả HTTP 200');
    assert.strictEqual(chatRes.body.ok, true, 'Lấy tin nhắn chat phải thành công');
    assert.ok(Array.isArray(chatRes.body.msgs), 'Response phải có mảng msgs');
    assert.strictEqual(chatRes.body.me, registeredUid);
    console.log('  ✓ Chat request hoạt động bình thường, trả về kênh global an toàn.');

    console.log('\n========================================');
    console.log('CRITICAL FLOW 7: REQUEST SAI TOKEN BỊ TỪ CHỐI 401 UNAUTHORIZED');
    console.log('========================================');

    console.log('▶ Bước 7: Thử gửi request với token giả mạo tới /xhrpg_logout.php...');
    const badTokenRes = await postJson('/xhrpg_logout.php', {
      line_uid: registeredUid,
      session_token: 'fake_malicious_token_12345'
    });
    assert.strictEqual(badTokenRes.status, 401, 'Request token sai bắt buộc phải trả HTTP 401');
    assert.strictEqual(badTokenRes.body.ok, false, 'Không được phép thành công với token sai');
    assert.ok(badTokenRes.body.error.includes('Unauthorized'), 'Thông báo lỗi phải có Unauthorized');
    console.log('  ✓ Token giả mạo bị chặn đứng tại tầng HTTP với status 401 Unauthorized.');

    console.log('\n========================================');
    console.log('CRITICAL FLOW 8 & 9: LOGOUT VÀ TỪ CHỐI TOKEN CŨ');
    console.log('========================================');

    // 8. Logout
    console.log('▶ Bước 8: Đăng xuất tài khoản qua HTTP POST /xhrpg_logout.php...');
    const logoutRes = await postJson('/xhrpg_logout.php', {
      line_uid: registeredUid,
      session_token: validToken
    });
    assert.strictEqual(logoutRes.status, 200, 'Logout hợp lệ phải trả HTTP 200');
    assert.strictEqual(logoutRes.body.ok, true, 'Logout phải thành công');
    assert.ok(logoutRes.body.msg && logoutRes.body.msg.includes('Đăng xuất'));

    // Kiểm tra database: token bị xóa
    db.load();
    const userInDb = db.data.users.find(u => u.line_uid === registeredUid);
    assert.strictEqual(userInDb.session_token, null, 'session_token trong database phải bị set null');
    console.log('  ✓ Đăng xuất thành công, session_token đã bị thu hồi trong database.');

    // 9. Dùng lại token cũ
    console.log('▶ Bước 9: Thử dùng lại token cũ sau khi đã đăng xuất...');
    const oldTokenRes = await postJson('/xhrpg_logout.php', {
      line_uid: registeredUid,
      session_token: validToken
    });
    assert.strictEqual(oldTokenRes.status, 401, 'Token cũ sau logout phải bị từ chối 401');
    assert.strictEqual(oldTokenRes.body.ok, false);
    console.log('  ✓ Token cũ sau logout bị từ chối hoàn toàn (HTTP 401).');

    console.log('\n========================================');
    console.log('CRITICAL FLOW 10: KIỂM TRA GACHA/AUCTION ĐÃ TRIỂN KHAI VÀ 7 ROUTE BACKLOG TRẢ HTTP 501');
    console.log('========================================');

    // Kiểm tra /xhrpg_gacha.php đã triển khai router thật (không còn trả 501)
    const gachaRes = await postJson('/xhrpg_gacha.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'info'
    });
    assert.strictEqual(gachaRes.status, 401, 'Gacha với token đã logout phải trả về HTTP 401 Unauthorized');
    assert.strictEqual(gachaRes.body.ok, false);
    assert.notStrictEqual(gachaRes.status, 501, 'Gacha KHÔNG được trả về 501 Not Implemented nữa');
    console.log('  ✓ Endpoint Gacha (/xhrpg_gacha.php) xác nhận đã triển khai router thật (xác thực token chuẩn, không phải 501).');

    // Kiểm tra /xhrpg_auction.php đã triển khai router thật (không còn trả 501)
    const aucRes = await postJson('/xhrpg_auction.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'state'
    });
    assert.strictEqual(aucRes.status, 401, 'Auction với token đã logout phải trả về HTTP 401 Unauthorized');
    assert.strictEqual(aucRes.body.ok, false);
    assert.notStrictEqual(aucRes.status, 501, 'Auction KHÔNG được trả về 501 Not Implemented nữa');
    console.log('  ✓ Endpoint Auction (/xhrpg_auction.php) xác nhận đã triển khai router thật (xác thực token chuẩn, không phải 501).');

    const orionRes = await postJson('/xhrpg_orion_raid.php', {
      line_uid: registeredUid,
      session_token: validToken,
      action: 'info'
    });
    assert.strictEqual(orionRes.status, 401, 'Orion Raid với token đã logout phải trả về HTTP 401 Unauthorized');
    assert.strictEqual(orionRes.body.ok, false);
    assert.notStrictEqual(orionRes.status, 501, 'Orion Raid KHÔNG được trả về 501 Not Implemented nữa');
    console.log('  ✓ Endpoint Orion Raid (/xhrpg_orion_raid.php) xác nhận đã triển khai router thật (xác thực token chuẩn, không phải 501).');

    const deferredEndpoints = [
      { name: 'migrate', path: '/xhrpg_migrate.php' },
      { name: 'voucher', path: '/xhrpg_voucher.php' },
      { name: 'stripe_topup', path: '/xhrpg_stripe_topup.php' },
      { name: 'topup_promo', path: '/xhrpg_topup_promo.php' },
      { name: 'coda_paycode', path: '/xhrpg_coda_paycode.php' },
      { name: 'xsolla_token', path: '/xhrpg_xsolla_token.php' }
    ];

    for (const ep of deferredEndpoints) {
      const defRes = await postJson(ep.path, {
        line_uid: registeredUid,
        session_token: validToken
      });
      assert.strictEqual(defRes.status, 501, `Endpoint ${ep.path} bắt buộc phải trả HTTP 501`);
      assert.strictEqual(defRes.body.ok, false, `Endpoint ${ep.path} tuyệt đối không được trả về ok: true`);
      assert.ok(defRes.body.error, `Endpoint ${ep.path} phải có error message`);
      console.log(`  ✓ Endpoint ${ep.name} (${ep.path}) trả về HTTP 501 Not Implemented an toàn.`);
    }

    console.log('\n🎉 TOÀN BỘ 10 FLOW INTEGRATION SMOKE TEST ĐÃ PASS 100% QUA EXPRESS HTTP THẬT!');
  } finally {
    // Đóng HTTP server để tránh dangling process
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('🔒 Express HTTP Server đã đóng kết nối an toàn.');
          resolve();
        });
      });
    }

    // Dọn dẹp bản ghi test khỏi database
    if (registeredUid) {
      cleanupDatabase([registeredUid, username]);
      console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
    }
  }
}

runHttpSmokeTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ HTTP SMOKE TEST FAILED:', err);
  process.exit(1);
});
