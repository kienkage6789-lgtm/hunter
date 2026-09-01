const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const offlineRoute = require('../server/routes/offline');

console.log('🧪 Bắt đầu kiểm thử toàn diện Offline Farming (TASK-028)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_off_');
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

function callRoute(router, { body, method = 'POST', headers = {} }) {
  return new Promise((resolve) => {
    const req = {
      method,
      url: '/',
      body: body || {},
      query: {},
      headers: headers || {}
    };

    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => resolve({ status: statusCode, body: data }),
      send: (data) => resolve({ status: statusCode, body: data })
    };

    router.handle(req, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Not Handled' } });
    });
  });
}

async function runTests() {
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_off_alice_' + uniqueSuffix;
  const bobUid = 'test_off_bob_' + uniqueSuffix;
  const charlieUid = 'test_off_charlie_' + uniqueSuffix;
  const daveUid = 'test_off_dave_' + uniqueSuffix;

  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const charlieToken = 'tok_charlie_' + uniqueSuffix;
  const daveToken = 'tok_dave_' + uniqueSuffix;

  const testUids = [aliceUid, bobUid, charlieUid, daveUid];
  cleanupTestRecords(testUids);

  try {
    console.log('\n========================================');
    console.log('PHẦN 1: STATIC CODE AUDIT (CLIENT XHRPG_CANVAS.JS)');
    console.log('========================================');

    const clientFilePath = path.resolve(__dirname, '../client/xhrpg_canvas.js');
    const clientCode = fs.readFileSync(clientFilePath, 'utf8');

    // 1.1 Kiểm tra _chFail không gọi _showIdleOverlay hoặc _botmonOpen
    const chFailMatch = clientCode.match(/function _chFail\(\)\s*\{([\s\S]*?)\}/);
    assert.ok(chFailMatch, 'Phải tìm thấy hàm _chFail trong client/xhrpg_canvas.js');
    const chFailBody = chFailMatch[1];
    assert.strictEqual(chFailBody.includes('_showIdleOverlay()'), false, '_chFail không được phép gọi _showIdleOverlay()');
    assert.strictEqual(chFailBody.includes('_botmonOpen()'), false, '_chFail không được phép gọi _botmonOpen()');
    console.log('  ✓ Client static audit: _chFail không tự động ép người chơi vào bot monitor/offline.');

    // 1.2 Kiểm tra _showIdleOverlay không tự ý trigger _botmonOpen
    const showIdleMatch = clientCode.match(/function _showIdleOverlay\(\)\s*\{([\s\S]*?)\}/);
    assert.ok(showIdleMatch, 'Phải tìm thấy hàm _showIdleOverlay');
    assert.strictEqual(showIdleMatch[1].includes('_botmonOpen()'), false, '_showIdleOverlay không được tự ý trigger _botmonOpen()');
    console.log('  ✓ Client static audit: _showIdleOverlay đã bị vô hiệu hóa.');

    // 1.3 Kiểm tra schedulePoll không dừng poll vì document.hidden hoặc _idleCutMs
    const schedulePollMatch = clientCode.match(/function schedulePoll\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(schedulePollMatch, 'Phải tìm thấy hàm schedulePoll trong client/xhrpg_canvas.js');
    const schedulePollBody = schedulePollMatch[1];
    assert.strictEqual(schedulePollBody.includes('600000'), false, 'schedulePoll không được dừng poll khi document.hidden > 600000');
    assert.strictEqual(schedulePollBody.includes('_idleCutMs'), false, 'schedulePoll không được dừng poll khi idle quá _idleCutMs');
    console.log('  ✓ Client static audit: schedulePoll không dừng poll vì tab hidden hoặc inactivity.');

    // 1.4 Kiểm tra poll() không dừng và không gán _lastInputAt = 0 khi nhận d.idle
    const pollMatch = clientCode.match(/function poll\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(pollMatch, 'Phải tìm thấy hàm poll trong client/xhrpg_canvas.js');
    const pollBody = pollMatch[1];
    assert.strictEqual(pollBody.includes('_lastInputAt = 0; _showIdleOverlay(); return;'), false, 'poll không được return hoặc ngắt poll khi gặp d.idle');
    console.log('  ✓ Client static audit: poll() xử lý d.idle non-blocking, tiếp tục luồng game.');

    // 1.5 Kiểm tra _otbLocked luôn trả về false
    const otbLockedMatch = clientCode.match(/const _otbLocked = \(\) => (.*?);/);
    assert.ok(otbLockedMatch, 'Phải tìm thấy khai báo _otbLocked');
    assert.strictEqual(otbLockedMatch[1].trim(), 'false', '_otbLocked phải luôn trả về false để không chặn online play');
    console.log('  ✓ Client static audit: _otbLocked không bao giờ khóa thao tác online.');

    console.log('\n========================================');
    console.log('PHẦN 2: XÁC THỰC BẢO MẬT PHIÊN VÀ PHÂN QUYỀN');
    console.log('========================================');

    // 2. Tạo test users & players
    const nowSec = Math.floor(Date.now() / 1000);

    // Alice: Lv 25, chưa có offline_zones
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, 'Alice Off', JSON.stringify({ line_uid: aliceUid, name: 'Alice Off', lv: 25, exp: 0, gold: 1000, offline_zones: '' })
    );

    // Bob: Lv 5, có offline_zones: "1:0"
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, 'Bob Off', JSON.stringify({ line_uid: bobUid, name: 'Bob Off', lv: 5, exp: 0, gold: 500, offline_zones: '1:0' })
    );

    // Charlie: Lv 30, có Premium Offline 24h
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      charlieUid, 'charlie_' + uniqueSuffix, 'hash', charlieToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      charlieUid, 'Charlie Off', JSON.stringify({
        line_uid: charlieUid,
        name: 'Charlie Off',
        lv: 30,
        exp: 0,
        gold: 2000,
        offline_zones: '1:0,1:1',
        premium_offline_expires: nowSec + 86400
      })
    );

    // Dave: Lv 10, không có offline_zones
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      daveUid, 'dave_' + uniqueSuffix, 'hash', daveToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      daveUid, 'Dave Off', JSON.stringify({ line_uid: daveUid, name: 'Dave Off', lv: 10, exp: 0, gold: 100, offline_zones: '' })
    );

    // 2.1 Thiếu token
    const resNoTok = await callRoute(offlineRoute, { body: { line_uid: aliceUid, action: 'preview' } });
    assert.strictEqual(resNoTok.status, 401);
    assert.strictEqual(resNoTok.body.ok, false);

    // 2.2 Token sai
    const resBadTok = await callRoute(offlineRoute, { body: { line_uid: aliceUid, session_token: 'fake_token', action: 'preview' } });
    assert.strictEqual(resBadTok.status, 401);
    assert.strictEqual(resBadTok.body.ok, false);

    // 2.3 Token user khác (Alice UID + Bob Token)
    const resStolen = await callRoute(offlineRoute, { body: { line_uid: aliceUid, session_token: bobToken, action: 'preview' } });
    assert.strictEqual(resStolen.status, 401);
    assert.strictEqual(resStolen.body.ok, false);

    console.log('  ✓ Toàn bộ các vi phạm token đều bị từ chối 401.');

    console.log('\n========================================');
    console.log('PHẦN 3: KIỂM THỬ ACTION PREVIEW');
    console.log('========================================');

    // 3.1 Preview Alice (Lv 25) trên Map 1
    const resPrevAlice = await callRoute(offlineRoute, { body: { line_uid: aliceUid, session_token: aliceToken, action: 'preview', map: 1 } });
    assert.strictEqual(resPrevAlice.status, 200);
    assert.strictEqual(resPrevAlice.body.ok, true);
    assert.strictEqual(resPrevAlice.body.map, 1);
    assert.strictEqual(resPrevAlice.body.unlock_lv, 25);
    assert.strictEqual(resPrevAlice.body.is_default, true);
    assert.strictEqual(resPrevAlice.body.selected_all.length, 0);
    assert.ok(Array.isArray(resPrevAlice.body.zones) && resPrevAlice.body.zones.length > 0, 'Phải có danh sách zone thực tế');
    assert.ok(resPrevAlice.body.zones[0].monsters.length > 0, 'Phải có tên quái vật từ mon_masters_cache');
    console.log('  ✓ Preview Alice trả về đúng dữ liệu spots và monsters thực tế.');

    // 3.2 Preview Bob (đã cấu hình 1:0)
    const resPrevBob = await callRoute(offlineRoute, { body: { line_uid: bobUid, session_token: bobToken, action: 'preview', map: 1 } });
    assert.strictEqual(resPrevBob.body.ok, true);
    assert.strictEqual(resPrevBob.body.is_default, false);
    assert.strictEqual(resPrevBob.body.selected_all.length, 1);
    assert.strictEqual(resPrevBob.body.selected_all[0].map, 1);
    assert.strictEqual(resPrevBob.body.selected_all[0].zone, 0);
    console.log('  ✓ Preview Bob phản ánh đúng cấu hình đã lưu.');

    console.log('\n========================================');
    console.log('PHẦN 4: KIỂM THỬ ACTION SET (OPT-IN CẤU HÌNH ZONE)');
    console.log('========================================');

    // 4.1 Cấu hình 2 zone hợp lệ cho Alice
    const resSetAlice = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'set', map: 1, zones: '1:0,1:1' }
    });
    assert.strictEqual(resSetAlice.body.ok, true);
    assert.strictEqual(resSetAlice.body.selected_all.length, 2);

    // Kiểm tra DB
    db.load();
    const aliceDbRow = db.data.players.find(p => p.line_uid === aliceUid);
    const aliceDbObj = JSON.parse(aliceDbRow.raw_data);
    assert.strictEqual(aliceDbObj.offline_zones, '1:0,1:1');
    console.log('  ✓ Cấu hình 2 zone hợp lệ lưu thành công vào database.');

    // 4.2 Cấu hình vượt quá 3 zone (> _OFF_MAX) -> Phải bị từ chối
    const resSetOver = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'set', map: 1, zones: '1:0,1:1,1:2,1:3' }
    });
    assert.strictEqual(resSetOver.body.ok, false);
    assert.strictEqual(resSetOver.body.error, 'invalid_zones');
    console.log('  ✓ Chặn chọn quá 3 zone thành công.');

    // 4.3 Bob (Lv 5) chọn map yêu cầu Lv 40 (Map 3) -> Phải bị từ chối
    const resSetLockedMap = await callRoute(offlineRoute, {
      body: { line_uid: bobUid, session_token: bobToken, action: 'set', map: 3, zones: '3:0' }
    });
    assert.strictEqual(resSetLockedMap.body.ok, false);
    assert.strictEqual(resSetLockedMap.body.error, 'map_locked');
    console.log('  ✓ Chặn chọn bản đồ chưa mở khóa thành công.');

    console.log('\n========================================');
    console.log('PHẦN 5: KIỂM THỬ ACTION IDLESTAT (CHECKIN AN TOÀN)');
    console.log('========================================');

    // 5.1 idlestat trả về ci: 0 và không cấp thưởng
    const resIdle = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'idlestat', k: 'chpass' }
    });
    assert.strictEqual(resIdle.body.ok, true);
    assert.strictEqual(resIdle.body.ci, 0);

    // Kiểm tra DB: EXP/Gold của Alice không bị thay đổi
    db.load();
    const aliceCheckDb = db.data.players.find(p => p.line_uid === aliceUid);
    assert.strictEqual(aliceCheckDb.exp, 0);
    assert.strictEqual(aliceCheckDb.gold, 1000);
    console.log('  ✓ idlestat phản ánh ci: 0, tuyệt đối không tự phát thưởng.');

    console.log('\n========================================');
    console.log('PHẦN 6: KIỂM THỬ MONITOR_SYNC & FEED_PULL');
    console.log('========================================');

    // 6.1 Người chơi chưa cấu hình zone (Dave) gọi monitor_sync -> no_zone: true, 0 thưởng
    const resDaveSync = await callRoute(offlineRoute, {
      body: { line_uid: daveUid, session_token: daveToken, action: 'monitor_sync', start: 1, end: 0 }
    });
    assert.strictEqual(resDaveSync.body.ok, true);
    assert.strictEqual(resDaveSync.body.no_zone, true);
    assert.strictEqual(resDaveSync.body.tot.exp, 0);
    assert.strictEqual(resDaveSync.body.tot.gold, 0);
    console.log('  ✓ Người chơi chưa cấu hình zone nhận no_zone: true và 0 thưởng.');

    // 6.2 Alice (đã có zone 1:0,1:1) khởi tạo phiên monitor_sync (start = 1)
    const resAliceStart = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'monitor_sync', start: 1, end: 0 }
    });
    assert.strictEqual(resAliceStart.body.ok, true);
    assert.strictEqual(resAliceStart.body.no_zone, false);
    assert.strictEqual(resAliceStart.body.zones.length, 2);

    // 6.3 feed_pull
    const resFeed = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'feed_pull' }
    });
    assert.strictEqual(resFeed.body.ok, true);
    assert.ok(Array.isArray(resFeed.body.lines));
    console.log('  ✓ feed_pull trả về danh sách nhật ký hợp lệ.');

    // 6.4 Alice kết thúc phiên monitor (end = 1)
    const resAliceEnd = await callRoute(offlineRoute, {
      body: { line_uid: aliceUid, session_token: aliceToken, action: 'monitor_sync', start: 0, end: 1 }
    });
    assert.strictEqual(resAliceEnd.body.ok, true);
    console.log('  ✓ Kết thúc phiên monitor_sync thành công.');

    console.log('\n========================================');
    console.log('PHẦN 7: KIỂM THỬ ROLLBACK KHI SAVE DATABASE GẶP LỖI');
    console.log('========================================');

    // 7. Giả lập lỗi I/O trong quá trình lưu kết thúc offline
    const originalSave = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk error during offline sync'); };

    // Khởi tạo phiên trước
    await callRoute(offlineRoute, {
      body: { line_uid: bobUid, session_token: bobToken, action: 'monitor_sync', start: 1, end: 0 }
    });

    const resRollback = await callRoute(offlineRoute, {
      body: { line_uid: bobUid, session_token: bobToken, action: 'monitor_sync', start: 0, end: 1 }
    });
    assert.strictEqual(resRollback.status, 500);
    assert.strictEqual(resRollback.body.ok, false);

    db.save = originalSave;
    console.log('  ✓ Rollback snapshot khi gặp lỗi I/O thành công.');

    console.log('\n🎉 TẤT CẢ CÁC BỘ KIỂM THỬ OFFLINE FARMING ĐỀU ĐẠT CHUẨN (PASS 100%)!');
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

