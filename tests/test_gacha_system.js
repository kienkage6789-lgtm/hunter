/**
 * tests/test_gacha_system.js
 * Kiểm thử toàn diện hệ thống Gacha Server-Authoritative (TASK-042)
 * 
 * Kiểm tra các tính chất:
 * 1. Xác thực bảo mật: line_uid & session_token bắt buộc (HTTP 401 nếu thiếu hoặc sai).
 * 2. Action 'info': Quota hàng ngày, cấp độ, số dư P, lượt quay miễn phí ban đầu (next_cost: 0).
 * 3. Spin miễn phí lượt đầu tiên: Không trừ P, cộng G chính xác theo multiplier ngẫu nhiên (1..6).
 * 4. Spin có phí theo bậc thang (Ladder): Trừ P chính xác, cộng G chính xác.
 * 5. Chống số dư âm (Insufficient balance): Reject giao dịch nếu thiếu P, không âm balance.
 * 6. Server-authoritative: Tuyệt đối không chấp nhận cost hoặc reward do client gửi lên.
 * 7. Daily quota boundary: Cho phép tối đa 10 lượt/ngày; lượt 11 bị chặn; reset chuẩn theo ngày.
 * 8. Idempotency: Gửi request trùng idempotency_key không gây double-charge hoặc double-reward.
 * 9. Concurrency / Race Condition: Gửi nhiều spin đồng thời được tuần tự hóa an toàn qua Mutex.
 * 10. Dọn dẹp test data 100%.
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
  player.p_points = parseInt(player.p_points) || 500;
  return player;
}

function saveTestPlayer(pRow, playerObj) {
  pRow.gold = playerObj.gold;
  pRow.p_points = playerObj.p_points;
  if (playerObj.gacha) pRow.gacha = playerObj.gacha;
  pRow.raw_data = JSON.stringify(playerObj);
  db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(pRow.raw_data, pRow.line_uid);
  db.save();
}

async function runGachaTests() {
  console.log('🧪 Bắt đầu kiểm thử Hệ thống Gacha Server-Authoritative (TASK-042)...\n');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const testUsername = `gacha_usr_${uniqueSuffix}`;
  const testPassword = `pass_${uniqueSuffix}`;
  let testUid = null;
  let sessionToken = null;

  try {
    // =========================================================================
    // PHẦN 1: XÁC THỰC BẢO MẬT (AUTH CHECK)
    // =========================================================================
    console.log('========================================');
    console.log('PHẦN 1: XÁC THỰC BẢO MẬT VÀ SESSION TOKEN');
    console.log('========================================');

    // 1.1 Request thiếu token
    const noAuthRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'info' })
    });
    assert.strictEqual(noAuthRes.status, 401, 'Thiếu credentials phải trả về HTTP 401');
    console.log('  ✓ Request không có token bị chặn với HTTP 401 Unauthorized.');

    // 1.2 Request token giả mạo
    const fakeAuthRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: 'fake_uid', session_token: 'fake_tok', action: 'info' })
    });
    assert.strictEqual(fakeAuthRes.status, 401, 'Token giả mạo phải trả về HTTP 401');
    console.log('  ✓ Request token giả mạo bị chặn với HTTP 401 Unauthorized.');

    // Đăng ký tài khoản kiểm thử hợp lệ
    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: testPassword })
    });
    const regData = await regRes.json();
    assert.strictEqual(regData.ok, true);
    testUid = regData.line_uid;
    sessionToken = regData.session_token;
    console.log(`  ✓ Đăng ký tài khoản kiểm thử thành công: uid=${testUid}`);

    // =========================================================================
    // PHẦN 2: KIỂM THỬ ACTION 'INFO' (THÔNG TIN KHỞI TẠO)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 2: KIỂM THỬ ACTION INFO (KHỞI TẠO)');
    console.log('========================================');

    const infoRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'info' })
    });
    assert.strictEqual(infoRes.status, 200);
    const infoData = await infoRes.json();
    assert.strictEqual(infoData.ok, 1, 'infoData.ok phải là 1');
    assert.strictEqual(infoData.used, 0, 'Lượt quay ban đầu phải là 0');
    assert.strictEqual(infoData.max, 10, 'Quota tối đa hàng ngày phải là 10');
    assert.strictEqual(infoData.next_cost, 0, 'Lượt quay đầu tiên phải miễn phí (0 P)');
    assert.strictEqual(infoData.base, 200, 'Base gold lv 1 phải là 200 G');
    assert.strictEqual(infoData.min_lv, 1, 'Min level phải là 1');
    console.log(`  ✓ Info endpoint trả về dữ liệu chuẩn: used=${infoData.used}, max=${infoData.max}, next_cost=${infoData.next_cost}P, base=${infoData.base}G`);

    // =========================================================================
    // PHẦN 3: SPIN MIỄN PHÍ LƯỢT ĐẦU TIÊN (COST = 0 P)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 3: SPIN MIỄN PHÍ LƯỢT ĐẦU (FREE SPIN)');
    console.log('========================================');

    db.load();
    const pRowBefore = db.data.players.find(p => p.line_uid === testUid);
    const pBeforeFree = unpackTestPlayer(pRowBefore);
    const initialGold = pBeforeFree.gold;
    const initialP = pBeforeFree.p_points;

    const freeSpinRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
    });
    assert.strictEqual(freeSpinRes.status, 200);
    const freeSpinData = await freeSpinRes.json();
    assert.strictEqual(freeSpinData.ok, 1);
    assert.ok(freeSpinData.mult >= 1 && freeSpinData.mult <= 6, 'Multiplier phải trong khoảng 1 đến 6');
    assert.strictEqual(freeSpinData.base, 200);
    assert.strictEqual(freeSpinData.amount, 200 * freeSpinData.mult);
    assert.strictEqual(freeSpinData.used, 1, 'Số lượt quay sau lần 1 phải là 1');
    assert.strictEqual(freeSpinData.next_cost, 10, 'Chi phí cho lượt thứ 2 phải là 10 P');
    assert.strictEqual(freeSpinData.player.p_points, initialP, 'Lượt đầu free tuyệt đối không được trừ P');
    assert.strictEqual(freeSpinData.player.gold, initialGold + freeSpinData.amount, 'Gold phải được cộng chính xác');
    console.log(`  ✓ Lượt 1 (Free) thành công: ×${freeSpinData.mult} -> nhận +${freeSpinData.amount} G. P không đổi (${freeSpinData.player.p_points} P). Next cost: ${freeSpinData.next_cost} P.`);

    // =========================================================================
    // PHẦN 4: SPIN CÓ PHÍ THEO BẬC THANG (COST = 10 P)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 4: SPIN CÓ PHÍ THEO BẬC THANG LADDER');
    console.log('========================================');

    const paidSpinRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
    });
    assert.strictEqual(paidSpinRes.status, 200);
    const paidSpinData = await paidSpinRes.json();
    assert.strictEqual(paidSpinData.ok, 1);
    assert.strictEqual(paidSpinData.used, 2, 'Số lượt quay sau lần 2 phải là 2');
    assert.strictEqual(paidSpinData.next_cost, 10, 'Chi phí lượt thứ 3 là 10 P');
    assert.strictEqual(paidSpinData.player.p_points, initialP - 10, 'Lượt 2 phải bị trừ đúng 10 P');
    assert.strictEqual(paidSpinData.player.gold, initialGold + freeSpinData.amount + paidSpinData.amount);
    console.log(`  ✓ Lượt 2 thành công: Trừ 10 P (còn ${paidSpinData.player.p_points} P), nhận +${paidSpinData.amount} G (×${paidSpinData.mult}).`);

    // =========================================================================
    // PHẦN 5: CHỐNG SỐ DƯ ÂM VÀ TỪ CHỐI THIẾU P
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 5: CHỐNG SỐ DƯ ÂM KHI THIẾU P');
    console.log('========================================');

    // Chỉnh số dư P của người chơi xuống 5 (trong khi cần 10 P)
    db.load();
    const pRowPlayer = db.data.players.find(p => p.line_uid === testUid);
    const pPlayer = unpackTestPlayer(pRowPlayer);
    pPlayer.p_points = 5;
    saveTestPlayer(pRowPlayer, pPlayer);

    const brokeSpinRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
    });
    assert.strictEqual(brokeSpinRes.status, 200);
    const brokeSpinData = await brokeSpinRes.json();
    assert.strictEqual(brokeSpinData.ok, false, 'Không đủ P phải bị từ chối');
    assert.ok(brokeSpinData.error.includes('không đủ P points'), 'Thông báo lỗi phải nêu rõ thiếu P');

    // Xác nhận số dư không bị âm và lượt quay không bị tăng
    db.load();
    const pRowAfterBroke = db.data.players.find(p => p.line_uid === testUid);
    const pAfterBroke = unpackTestPlayer(pRowAfterBroke);
    assert.strictEqual(pAfterBroke.p_points, 5, 'Số dư P phải giữ nguyên 5, không bị trừ');
    assert.strictEqual(pAfterBroke.gacha.used, 2, 'Lượt used phải giữ nguyên 2');
    console.log('  ✓ Hệ thống từ chối chính xác khi thiếu P; số dư P được bảo toàn, không bị âm.');

    // Phục hồi lại P cho các bài test tiếp theo
    pAfterBroke.p_points = 1000;
    saveTestPlayer(pRowAfterBroke, pAfterBroke);

    // =========================================================================
    // PHẦN 6: CHỐNG CLIENT TAMPERING (KHÔNG TIN DỮ LIỆU CLIENT)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 6: CHỐNG CLIENT TAMPERING');
    console.log('========================================');

    // Client cố tình gửi cost = 0, mult = 6, amount = 9999999
    const tamperRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: testUid,
        session_token: sessionToken,
        action: 'spin',
        cost: 0,
        mult: 6,
        amount: 99999999
      })
    });
    const tamperData = await tamperRes.json();
    assert.strictEqual(tamperData.ok, 1);
    // Amount phải là lv * 200 * mult (tối đa 1200), không phải 99999999
    assert.ok(tamperData.amount <= 1200, 'Server phải tính amount authoritative, không tin client');
    assert.strictEqual(tamperData.used, 3);
    console.log('  ✓ Client giả lập gửi cost:0, amount:99999999 bị server bỏ qua hoàn toàn; server tự tính thưởng chính xác.');

    // =========================================================================
    // PHẦN 7: DAILY QUOTA VÀ QUOTA RESET
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 7: DAILY QUOTA VÀ RESET THEO NGÀY');
    console.log('========================================');

    // Quay tiếp cho đến khi đủ 10 lượt (used = 10)
    for (let i = 4; i <= 10; i++) {
      const res = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
      });
      const d = await res.json();
      assert.strictEqual(d.ok, 1);
      assert.strictEqual(d.used, i);
    }
    console.log('  ✓ Đã quay thành công đủ 10 lượt trong ngày (Quota tối đa).');

    // Thử quay lượt thứ 11 -> Phải bị chặn
    const overSpinRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
    });
    const overSpinData = await overSpinRes.json();
    assert.strictEqual(overSpinData.ok, false, 'Lượt quay thứ 11 phải bị từ chối');
    assert.ok(overSpinData.error.includes('hết lượt quay'), 'Thông báo hết quota rõ ràng');
    console.log('  ✓ Lượt quay thứ 11 bị chặn chuẩn xác (báo hết lượt quay hôm nay).');

    // Giả lập sang ngày hôm sau -> Reset Quota
    db.load();
    const pRowForReset = db.data.players.find(p => p.line_uid === testUid);
    const pForReset = unpackTestPlayer(pRowForReset);
    pForReset.gacha.date = '2020-01-01'; // Ngày cũ
    saveTestPlayer(pRowForReset, pForReset);

    const resetInfoRes = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'info' })
    });
    const resetInfoData = await resetInfoRes.json();
    assert.strictEqual(resetInfoData.used, 0, 'Sang ngày mới lượt used phải được reset về 0');
    assert.strictEqual(resetInfoData.next_cost, 0, 'Sang ngày mới lượt đầu tiên phải là Free (0 P)');
    console.log('  ✓ Chuyển sang ngày mới: Hệ thống tự động reset used=0 và next_cost=0P hoàn hảo.');

    // =========================================================================
    // PHẦN 8: IDEMPOTENCY KEY (CHỐNG RETRY DOUBLE CHARGE / DOUBLE REWARD)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 8: IDEMPOTENCY RETRY PROTECTION');
    console.log('========================================');

    const testIdemKey = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    // Gửi request lần 1 với Idempotency Key
    const idem1Res = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: testUid,
        session_token: sessionToken,
        action: 'spin',
        idempotency_key: testIdemKey
      })
    });
    const idem1Data = await idem1Res.json();
    assert.strictEqual(idem1Data.ok, 1);
    const goldAfterIdem1 = idem1Data.player.gold;
    const pAfterIdem1 = idem1Data.player.p_points;
    const usedAfterIdem1 = idem1Data.used;

    // Gửi request lần 2 với CÙNG Idempotency Key (giả lập network retry)
    const idem2Res = await fetch(`${baseUrl}/xhrpg_gacha.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: testUid,
        session_token: sessionToken,
        action: 'spin',
        idempotency_key: testIdemKey
      })
    });
    const idem2Data = await idem2Res.json();
    assert.strictEqual(idem2Data.ok, 1);
    assert.strictEqual(idem2Data.cached, true, 'Request trùng idempotency_key phải trả kết quả cache');
    assert.strictEqual(idem2Data.mult, idem1Data.mult, 'Multiplier phải giống hệt lần 1');
    assert.strictEqual(idem2Data.amount, idem1Data.amount, 'Amount phải giống hệt lần 1');
    assert.strictEqual(idem2Data.used, usedAfterIdem1, 'Used không được tăng lần 2');
    assert.strictEqual(idem2Data.player.p_points, pAfterIdem1, 'P không bị trừ lần 2');
    assert.strictEqual(idem2Data.player.gold, goldAfterIdem1, 'Gold không bị cộng thưởng lần 2');
    console.log('  ✓ Request retry với idempotency_key trùng khớp trả về kết quả cũ an toàn (không double charge, không double reward).');

    // =========================================================================
    // PHẦN 9: KIỂM THỬ ĐỒNG THỜI (CONCURRENCY MUTEX LOCK)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 9: KIỂM THỬ ĐỒNG THỜI (CONCURRENT SPINS)');
    console.log('========================================');

    db.load();
    const pRowConc = db.data.players.find(p => p.line_uid === testUid);
    const curPlayer = unpackTestPlayer(pRowConc);
    const curUsed = curPlayer.gacha.used; // 1
    const pStartConcurrent = curPlayer.p_points;
    const gStartConcurrent = curPlayer.gold;

    // Bắn 3 requests spin đồng thời
    const concurrentPromises = [1, 2, 3].map(() =>
      fetch(`${baseUrl}/xhrpg_gacha.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: testUid, session_token: sessionToken, action: 'spin' })
      }).then(r => r.json())
    );

    const concurrentResults = await Promise.all(concurrentPromises);
    const successSpins = concurrentResults.filter(r => r.ok === 1);
    assert.strictEqual(successSpins.length, 3, 'Cả 3 request đồng thời phải được tuần tự hóa và thành công');

    db.load();
    const pRowFinal = db.data.players.find(p => p.line_uid === testUid);
    const finalPlayer = unpackTestPlayer(pRowFinal);
    assert.strictEqual(finalPlayer.gacha.used, curUsed + 3, 'Used phải tăng đúng 3 lần');
    assert.ok(finalPlayer.p_points < pStartConcurrent, 'P points phải bị trừ tương ứng');
    assert.ok(finalPlayer.gold > gStartConcurrent, 'Gold phải tăng tương ứng tổng thưởng');
    console.log(`  ✓ 3 request spin đồng thời được xếp hàng tuần tự qua Mutex: used=${finalPlayer.gacha.used}, không có race condition.`);

    console.log('\n🎉 TOÀN BỘ KIỂM THỬ HỆ THỐNG GACHA ĐÃ PASS 100%!');
  } finally {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(r => setTimeout(r, 50));
      await new Promise(r => server.close(r));
    }
    // Dọn dẹp test user
    if (testUid) {
      db.load();
      if (db.data && Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => u.line_uid !== testUid);
      }
      if (db.data && Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => p.line_uid !== testUid);
      }
      db.save();
      console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!\n');
    }
  }
}

runGachaTests().catch(err => {
  console.error('❌ LỖI GACHA TEST:', err);
  process.exit(1);
});
