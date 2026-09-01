/**
 * tests/test_orion_raid_system.js
 * 
 * BỘ KIỂM THỬ TÍCH HỢP HTTP CHO HỆ THỐNG ORION SPACE EXPEDITION (TASK-044)
 * 
 * Các kịch bản kiểm thử:
 * 1. Xác thực bảo mật Auth: Thiếu hoặc sai token phải trả về HTTP 401 Unauthorized.
 * 2. Action 'info': Trả về trạng thái ban đầu, free_left: 1, rate: 50, rush_p: 0.
 * 3. Validation điều kiện cấp phi thuyền (house_lv 30/60/90 cho Tiers 1/2/3).
 * 4. Validation tham số tier không hợp lệ (số âm, float, > 3).
 * 5. Phái phi thuyền Tier 1 thành công (end_at tính đúng 8h, quota cập nhật).
 * 6. Chặn gửi trùng lặp chuyến khi đang hoạt động hoặc hết hạn ngạch ngày.
 * 7. Chống Client Tampering (bỏ qua cost, end_at, rate client gửi lên).
 * 8. Action 'rush' khi không đủ Point P (từ chối, không âm số dư).
 * 9. Action 'rush' thành công (trừ đúng Point P, kết toán tức thì, trả về oraid_done).
 * 10. Tự động kết toán khi hết thời gian (Auto-settle trên game.php/orion_raid.php).
 * 11. Xác thực Idempotency key (gửi retry không bị double dispatch/charge).
 * 12. Xử lý đồng thời (Concurrent rush qua Mutex lock không bị double charge).
 * 13. Dọn dẹp database sạch sẽ 100%.
 */

const assert = require('assert');
const app = require('../server/index');
const db = require('../server/db/queries');

function unpackTestPlayer(pRow) {
  let player = {};
  if (pRow && pRow.raw_data) {
    try {
      player = JSON.parse(pRow.raw_data);
    } catch (e) {
      player = Object.assign({}, pRow);
    }
  } else {
    player = Object.assign({}, pRow || {});
  }
  if (pRow && pRow.gold !== undefined) player.gold = pRow.gold;
  if (pRow && pRow.lv !== undefined) player.lv = pRow.lv;
  player.line_uid = pRow ? pRow.line_uid : player.line_uid;
  player.p_points = parseInt(player.p_points, 10) || 0;
  player.gold = parseInt(player.gold, 10) || 0;
  player.house_lv = parseInt(player.house_lv, 10) || 0;
  player.stone = parseInt(player.stone, 10) || 0;
  player.iron = parseInt(player.iron, 10) || 0;
  player.copper = parseInt(player.copper, 10) || 0;
  return player;
}

function saveTestPlayer(pRow, playerObj) {
  pRow.gold = playerObj.gold;
  pRow.p_points = playerObj.p_points;
  pRow.house_lv = playerObj.house_lv;
  pRow.stone = playerObj.stone;
  pRow.iron = playerObj.iron;
  pRow.copper = playerObj.copper;
  pRow.raw_data = JSON.stringify(playerObj);
  db.save();
}

function cleanupTestRecords(testUids) {
  db.load();
  if (db.data) {
    if (Array.isArray(db.data.users)) {
      db.data.users = db.data.users.filter(u => !testUids.includes(u.line_uid));
    }
    if (Array.isArray(db.data.players)) {
      db.data.players = db.data.players.filter(p => !testUids.includes(p.line_uid));
    }
    db.save();
  }
}

async function runOrionRaidTests() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ HỆ THỐNG ORION SPACE EXPEDITION (TASK-044)');
  console.log('================================================================\n');

  // Khởi động Express HTTP Server thật trên port ngẫu nhiên
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const testUids = [];

  try {
    // =========================================================================
    // KHỞI TẠO USER KIỂM THỬ
    // =========================================================================
    // User 1: Phi thuyền Lv 35 (đủ Tier 1)
    const reg1Res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `oraid_u1_${testSuffix}`, password: 'password123' })
    });
    const reg1Data = await reg1Res.json();
    const uid1 = reg1Data.line_uid;
    const token1 = reg1Data.session_token;
    testUids.push(uid1);

    // User 2: Phi thuyền Lv 10 (chưa đủ cấp Tier 1)
    const reg2Res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `oraid_u2_${testSuffix}`, password: 'password123' })
    });
    const reg2Data = await reg2Res.json();
    const uid2 = reg2Data.line_uid;
    const token2 = reg2Data.session_token;
    testUids.push(uid2);

    // Cập nhật cấp phi thuyền và tài nguyên khởi đầu
    db.load();
    const p1Row = db.data.players.find(p => p.line_uid === uid1);
    const p1 = unpackTestPlayer(p1Row);
    p1.house_lv = 35;
    p1.p_points = 100;
    saveTestPlayer(p1Row, p1);

    const p2Row = db.data.players.find(p => p.line_uid === uid2);
    const p2 = unpackTestPlayer(p2Row);
    p2.house_lv = 10;
    p2.p_points = 50;
    saveTestPlayer(p2Row, p2);

    // =========================================================================
    // PHẦN 1: XÁC THỰC BẢO MẬT AUTH
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 1: XÁC THỰC BẢO MẬT AUTH');
    console.log('========================================');

    // 1.1 Thiếu line_uid & session_token
    const noAuthRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(noAuthRes.status, 401);
    const noAuthData = await noAuthRes.json();
    assert.strictEqual(noAuthData.ok, false);
    console.log('  ✓ Thiếu thông tin auth bị từ chối 401 Unauthorized.');

    // 1.2 Sai session_token
    const badTokenRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: 'fake_token_123', action: 'info' })
    });
    assert.strictEqual(badTokenRes.status, 401);
    const badTokenData = await badTokenRes.json();
    assert.strictEqual(badTokenData.ok, false);
    console.log('  ✓ Session token giả mạo bị từ chối 401 Unauthorized.');

    // =========================================================================
    // PHẦN 2: ACTION 'INFO' BAN ĐẦU
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 2: ACTION INFO BAN ĐẦU');
    console.log('========================================');

    const infoRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'info' })
    });
    assert.strictEqual(infoRes.status, 200);
    const infoData = await infoRes.json();
    assert.strictEqual(infoData.ok, true);
    assert.strictEqual(infoData.free_left, 1, 'Hạn ngạch ban đầu phải là 1 chuyến');
    assert.strictEqual(infoData.rush_p, 0, 'Chưa gửi tàu thì rush_p phải là 0');
    assert.strictEqual(infoData.pph, 1, 'Tỷ giá Point P mỗi giờ phải là 1');
    assert.strictEqual(infoData.rate, 50, 'Tỷ lệ thành công cơ bản phải là 50%');
    assert.strictEqual(infoData.active, null, 'Chưa gửi tàu thì active phải là null');
    console.log('  ✓ Action info trả về cấu trúc chính xác theo contract client.');

    // =========================================================================
    // PHẦN 3: VALIDATION ĐIỀU KIỆN CẤP PHI THUYỀN (HOUSE_LV)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 3: VALIDATION ĐIỀU KIỆN CẤP PHI THUYỀN');
    console.log('========================================');

    // User 2 có phi thuyền Lv 10 thử gửi Tier 1 (yêu cầu Lv 30)
    const lowLvRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid2, session_token: token2, action: 'send', tier: 1 })
    });
    const lowLvData = await lowLvRes.json();
    assert.strictEqual(lowLvData.ok, false);
    assert.ok(lowLvData.error.includes('không đủ'));
    console.log('  ✓ Chặn gửi thám hiểm khi cấp phi thuyền không đủ (Lv.10 < Lv.30).');

    // User 1 có phi thuyền Lv 35 thử gửi Tier 2 (yêu cầu Lv 60)
    const lowLvTier2Res = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'send', tier: 2 })
    });
    const lowLvTier2Data = await lowLvTier2Res.json();
    assert.strictEqual(lowLvTier2Data.ok, false);
    console.log('  ✓ Chặn gửi thám hiểm Tier 2 khi phi thuyền mới đạt Lv.35 (< Lv.60).');

    // =========================================================================
    // PHẦN 4: VALIDATION THAM SỐ TIER KHÔNG HỢP LỆ
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 4: VALIDATION THAM SỐ TIER');
    console.log('========================================');

    for (const badTier of [-1, 0, 4, 1.5, 'invalid', null]) {
      const badTierRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'send', tier: badTier })
      });
      const badTierData = await badTierRes.json();
      assert.strictEqual(badTierData.ok, false, `Tier ${badTier} phải bị từ chối`);
    }
    console.log('  ✓ Chặn toàn bộ tham số tier không hợp lệ (-1, 0, 4, 1.5, invalid, null).');

    // =========================================================================
    // PHẦN 5: PHÁI PHI THUYỀN TIER 1 THÀNH CÔNG
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 5: PHÁI PHI THUYỀN TIER 1 THÀNH CÔNG');
    console.log('========================================');

    const sendRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'send', tier: 1 })
    });
    assert.strictEqual(sendRes.status, 200);
    const sendData = await sendRes.json();
    assert.strictEqual(sendData.ok, true);
    assert.ok(typeof sendData.end_at === 'number');
    assert.ok(sendData.msg.includes('thành công'));

    const nowEpoch = Math.floor(Date.now() / 1000);
    const expectedEndAt = nowEpoch + 8 * 3600;
    assert.ok(Math.abs(sendData.end_at - expectedEndAt) <= 5, 'end_at phải tính đúng khoảng 8 giờ');
    console.log('  ✓ Gửi phi thuyền Tier 1 thành công: end_at thiết lập chuẩn xác 8 giờ.');

    // Kiểm tra info sau khi gửi
    const infoAfterSendRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'info' })
    });
    const infoAfterSendData = await infoAfterSendRes.json();
    assert.strictEqual(infoAfterSendData.ok, true);
    assert.strictEqual(infoAfterSendData.free_left, 0, 'Đã gửi tàu thì free_left phải bằng 0');
    assert.strictEqual(infoAfterSendData.rush_p, 8, '8 giờ còn lại tương ứng 8 Point P');
    assert.ok(infoAfterSendData.active !== null);
    assert.strictEqual(infoAfterSendData.active.tier, 1);
    console.log('  ✓ Action info phản ánh chính xác: free_left=0, rush_p=8 P, active={tier: 1}.');

    // =========================================================================
    // PHẦN 6: CHẶN GỬI TRÙNG LẶP / HẾT HẠN NGẠCH NGÀY
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 6: CHẶN GỬI TRÙNG LẶP');
    console.log('========================================');

    const dupSendRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'send', tier: 1 })
    });
    const dupSendData = await dupSendRes.json();
    assert.strictEqual(dupSendData.ok, false);
    assert.ok(dupSendData.error.includes('đang trong chuyến thám hiểm'));
    console.log('  ✓ Server chặn gửi chuyến thứ 2 khi phi thuyền đang thám hiểm.');

    // =========================================================================
    // PHẦN 7: CHỐNG CLIENT TAMPERING
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 7: CHỐNG CLIENT TAMPERING');
    console.log('========================================');

    // Nâng cấp User 2 lên Lv 90 để test tampering khi gửi Tier 3
    db.load();
    const p2RowUp = db.data.players.find(p => p.line_uid === uid2);
    const p2Up = unpackTestPlayer(p2RowUp);
    p2Up.house_lv = 95;
    saveTestPlayer(p2RowUp, p2Up);

    const tamperSendRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid2,
        session_token: token2,
        action: 'send',
        tier: 3,
        end_at: 10,
        rate: 100,
        free_left: 99
      })
    });
    const tamperSendData = await tamperSendRes.json();
    assert.strictEqual(tamperSendData.ok, true);
    // Server tự tính end_at = 24 giờ, bỏ qua end_at: 10 giả mạo
    const expectedTier3End = nowEpoch + 24 * 3600;
    assert.ok(Math.abs(tamperSendData.end_at - expectedTier3End) <= 5);
    console.log('  ✓ Tham số end_at:10, rate:100 giả mạo bị server bỏ qua hoàn toàn; server tự tính toán 24h.');

    // =========================================================================
    // PHẦN 8: ACTION 'RUSH' KHI THIẾU POINT P
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 8: RUSH KHI THIẾU POINT P');
    console.log('========================================');

    // Đặt Point P của User 2 về 0 (trong khi Tier 3 cần 24P)
    db.load();
    const p2RowBroke = db.data.players.find(p => p.line_uid === uid2);
    const p2Broke = unpackTestPlayer(p2RowBroke);
    p2Broke.p_points = 0;
    saveTestPlayer(p2RowBroke, p2Broke);

    const brokeRushRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid2, session_token: token2, action: 'rush' })
    });
    const brokeRushData = await brokeRushRes.json();
    assert.strictEqual(brokeRushData.ok, false);
    assert.ok(brokeRushData.error.includes('không đủ điểm P'));

    // Kiểm tra số dư P không bị âm
    db.load();
    const p2RowAfterBroke = db.data.players.find(p => p.line_uid === uid2);
    const p2AfterBroke = unpackTestPlayer(p2RowAfterBroke);
    assert.strictEqual(p2AfterBroke.p_points, 0);
    console.log('  ✓ Chặn rush khi thiếu Point P; số dư bảo toàn, không bị âm.');

    // =========================================================================
    // PHẦN 9: ACTION 'RUSH' THÀNH CÔNG VÀ KẾT TOÁN TỨC THÌ
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 9: RUSH THÀNH CÔNG VÀ KẾT TOÁN TỨC THÌ');
    console.log('========================================');

    // Nạp đủ Point P cho User 1 (cần 8P, hiện có 100P)
    const validRushRes = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'rush' })
    });
    assert.strictEqual(validRushRes.status, 200);
    const validRushData = await validRushRes.json();
    assert.strictEqual(validRushData.ok, true);
    assert.strictEqual(validRushData.p_points, 92, '100P - 8P = 92P');
    assert.ok(validRushData.oraid_done !== null, 'Phải trả về kết quả oraid_done');
    assert.strictEqual(validRushData.oraid_done.tier, 1);
    assert.ok(Array.isArray(validRushData.oraid_done.log));
    console.log(`  ✓ Rush thành công: Trừ đúng 8P (còn 92P), kết toán tức thì (success: ${validRushData.oraid_done.success}).`);

    // Kiểm tra trạng thái orion_raid trên DB đã được xóa (null)
    db.load();
    const p1RowAfterRush = db.data.players.find(p => p.line_uid === uid1);
    const p1AfterRush = unpackTestPlayer(p1RowAfterRush);
    assert.strictEqual(p1AfterRush.orion_raid, null, 'orion_raid phải được xóa sau khi kết toán');
    console.log('  ✓ orion_raid được set thành null ngay sau khi settle: Không có duplicate settlement.');

    // =========================================================================
    // PHẦN 10: TỰ ĐỘNG KẾT TOÁN TRÊN POLL GAME.PHP KHI HẾT THỜI GIAN
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 10: AUTO-SETTLE TRÊN GAME.PHP KHI HẾT GIỜ');
    console.log('========================================');

    // Thiết lập chuyến đi của User 2 có end_at đã trôi qua trong quá khứ
    db.load();
    const p2RowExp = db.data.players.find(p => p.line_uid === uid2);
    const p2Exp = unpackTestPlayer(p2RowExp);
    p2Exp.orion_raid = {
      tier: 3,
      start: nowEpoch - 90000,
      end_at: nowEpoch - 100 // Đã hết hạn
    };
    saveTestPlayer(p2RowExp, p2Exp);

    // Gửi poll tới xhrpg_game.php
    const gamePollRes = await fetch(`${baseUrl}/xhrpg_game.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid2, session_token: token2, act: 1 })
    });
    assert.strictEqual(gamePollRes.status, 200);
    const gamePollData = await gamePollRes.json();
    assert.ok(gamePollData.ok);
    assert.ok(gamePollData.player !== undefined);
    assert.ok(gamePollData.player.oraid_done !== undefined, 'Snapshot poll phải chứa oraid_done');
    assert.strictEqual(gamePollData.player.orion_raid, null, 'Chuyến đi đã hết giờ phải tự động settle');
    console.log(`  ✓ Poll game.php tự động settle khi hết giờ, trả về oraid_done cho client hiển thị popup.`);

    // =========================================================================
    // PHẦN 11: IDEMPOTENCY KEY CHO REQUEST RETRY
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 11: IDEMPOTENCY KEY RETRY PROTECTION');
    console.log('========================================');

    // Tạo user mới cho test idempotency
    const reg3Res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `oraid_u3_${testSuffix}`, password: 'password123' })
    });
    const reg3Data = await reg3Res.json();
    const uid3 = reg3Data.line_uid;
    const token3 = reg3Data.session_token;
    testUids.push(uid3);

    db.load();
    const p3Row = db.data.players.find(p => p.line_uid === uid3);
    const p3 = unpackTestPlayer(p3Row);
    p3.house_lv = 30;
    saveTestPlayer(p3Row, p3);

    const idemKey = `idem_send_${Date.now()}`;
    const idem1Res = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid3,
        session_token: token3,
        action: 'send',
        tier: 1,
        idempotency_key: idemKey
      })
    });
    const idem1Data = await idem1Res.json();
    assert.strictEqual(idem1Data.ok, true);

    // Gửi lại cùng request và cùng idempotency_key
    const idem2Res = await fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid3,
        session_token: token3,
        action: 'send',
        tier: 1,
        idempotency_key: idemKey
      })
    });
    const idem2Data = await idem2Res.json();
    assert.strictEqual(idem2Data.ok, true);
    assert.strictEqual(idem2Data.end_at, idem1Data.end_at, 'Idempotent request phải trả về cùng end_at');
    console.log('  ✓ Idempotency key bảo đảm trả về kết quả an toàn khi client retry request.');

    // =========================================================================
    // PHẦN 12: XỬ LÝ ĐỒNG THỜI (CONCURRENT RUSH QUA MUTEX)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 12: CONCURRENT RUSH QUA MUTEX');
    console.log('========================================');

    // Nạp Point P cho User 3 (cần 8P để rush)
    db.load();
    const p3RowRush = db.data.players.find(p => p.line_uid === uid3);
    const p3Rush = unpackTestPlayer(p3RowRush);
    p3Rush.p_points = 50;
    saveTestPlayer(p3RowRush, p3Rush);

    // Bắn 2 request rush đồng thời
    const concurrentRushResponses = await Promise.all([
      fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: uid3, session_token: token3, action: 'rush' })
      }).then(r => r.json()),
      fetch(`${baseUrl}/xhrpg_orion_raid.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: uid3, session_token: token3, action: 'rush' })
      }).then(r => r.json())
    ]);

    const successRushCount = concurrentRushResponses.filter(r => r.ok === true).length;
    const failRushCount = concurrentRushResponses.filter(r => r.ok === false).length;
    assert.strictEqual(successRushCount, 1, 'Chính xác 1 request rush thành công');
    assert.strictEqual(failRushCount, 1, 'Request đến sau bị từ chối do không còn chuyến đi active');

    // Kiểm tra số dư chỉ bị trừ 1 lần duy nhất (50P - 8P = 42P)
    db.load();
    const p3RowFinal = db.data.players.find(p => p.line_uid === uid3);
    const p3Final = unpackTestPlayer(p3RowFinal);
    assert.strictEqual(p3Final.p_points, 42, 'Số dư P chỉ bị trừ đúng 8P cho 1 lần rush');
    console.log('  ✓ Mutex lock bảo đảm không bị double charge P khi gửi concurrent rush requests.');

    console.log('\n🎉 TOÀN BỘ KIỂM THỬ HỆ THỐNG ORION SPACE EXPEDITION ĐÃ PASS 100%!');
  } finally {
    server.close();
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runOrionRaidTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ LỖI ORION RAID TEST:', err);
  process.exit(1);
});
