const assert = require('assert');
const db = require('../server/db/queries');
const upgradeRoute = require('../server/routes/upgrade');

console.log('🧪 Bắt đầu kiểm thử toàn diện hệ thống Nâng cấp (TASK-024 Upgrade System)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_upg_') || uid.startsWith('test_alice_') || uid.startsWith('test_bob_') || uid.startsWith('test_charlie_');
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

function callUpgrade(body) {
  return new Promise((resolve) => {
    upgradeRoute.handle(
      { method: 'POST', url: '/', body },
      {
        json: (res) => resolve(res)
      },
      () => {}
    );
  });
}

async function runTests() {
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_upg_alice_' + uniqueSuffix;
  const bobUid = 'test_upg_bob_' + uniqueSuffix;
  const aliceToken = 'tok_a_' + uniqueSuffix;
  const bobToken = 'tok_b_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid];

  cleanupTestRecords(testUids);

  try {
    const initialAlice = {
      line_uid: aliceUid,
      name: 'Alice Upgrade',
      lv: 65,
      gold: 50000000,
      p_points: 500,
      stone: 500000,
      copper: 500000,
      iron: 500000,
      wood: 500000,
      herb: 500000,
      country: 'VN',
      cc_home: 'VN',
      cc_moves: 0,
      cc_at: 0,
      archer_lv: 1,
      drone_lv: 1,
      drone_enabled: 1,
      house_lv: 25,
      vip_lv: 5,
      home_guards: [],
      eggs: JSON.stringify({ '10': { n: 5, m: 2 } }),
      job2_star: JSON.stringify({ atk: 0, def: 0 }),
      job2_exp: JSON.stringify({ atk: 600000000, def: 1000 }),
      job2_need: JSON.stringify({ atk: 500000000, def: 500000000 }),
      araid_on: 0,
      araid_g: 0,
      araid_c: 0
    };

    const initialBob = {
      line_uid: bobUid,
      name: 'Bob Upgrade',
      lv: 20,
      gold: 0,
      p_points: 0,
      stone: 0,
      copper: 0,
      iron: 0,
      wood: 0,
      herb: 0,
      country: 'TH',
      cc_home: 'TH',
      cc_moves: 1,
      cc_at: Math.floor(Date.now() / 1000), // Vừa chuyển xong, còn cooldown
      archer_lv: 1,
      drone_lv: 0,
      drone_expires: 0,
      drone_enabled: 0,
      house_lv: 1,
      vip_lv: 0,
      home_guards: [],
      eggs: JSON.stringify({}),
      job2_star: JSON.stringify({ atk: 0 }),
      job2_exp: JSON.stringify({ atk: 0 }),
      job2_need: JSON.stringify({ atk: 500000000 }),
      araid_on: 0,
      araid_g: 0,
      araid_c: 0
    };

    // Tạo users & players trong DB
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, p_points) VALUES (?, ?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken, 500
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, initialAlice.name, JSON.stringify(initialAlice)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token, p_points) VALUES (?, ?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken, 0
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, initialBob.name, JSON.stringify(initialBob)
    );

    // --- TEST 1: cc_list & cc_change ---
    console.log('\n▶ Test 1: Kiểm tra cc_list & cc_change (Danh sách và chuyển đổi quốc gia)...');
    const ccListRes = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'cc_list'
    });
    assert.strictEqual(ccListRes.ok, true);
    assert.ok(ccListRes.cc, 'Phải có object cc');
    assert.strictEqual(ccListRes.cc.now, 'VN');
    assert.strictEqual(ccListRes.cc.moves, 0);
    assert.strictEqual(ccListRes.cc.left, 0);
    assert.ok(Array.isArray(ccListRes.cc.list));

    // Alice chuyển quốc gia lần đầu (miễn phí) sang TH
    const ccChangeFree = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'cc_change',
      to: 'TH',
      pay: 'g'
    });

    const nowUtcHour = (new Date()).getUTCHours();
    const vnHour = (nowUtcHour + 7) % 24;
    const isWarHours = vnHour >= 21 && vnHour < 23;

    if (isWarHours) {
      assert.strictEqual(ccChangeFree.ok, false);
      assert.strictEqual(ccChangeFree.error, 'cc_war_hours');
      console.log('  ✓ Đã chặn cc_change đúng quy tắc trong giờ chiến tranh quốc gia (21:00 - 23:00 VN).');
    } else {
      assert.strictEqual(ccChangeFree.ok, true);
      assert.strictEqual(ccChangeFree.player.country, 'TH');
      assert.strictEqual(ccChangeFree.player.cc_moves, 1);
      assert.strictEqual(ccChangeFree.player.gold, initialAlice.gold, 'Lần đầu chuyển phải miễn phí Gold');

      // Chuyển lại ngay lập tức -> bị chặn do cooldown
      const ccChangeCooldown = await callUpgrade({
        line_uid: aliceUid,
        session_token: aliceToken,
        action: 'cc_change',
        to: 'VN',
        pay: 'g'
      });
      assert.strictEqual(ccChangeCooldown.ok, false);
      assert.strictEqual(ccChangeCooldown.error, 'cc_cooldown');

      // Chuyển sang cùng quốc gia hiện tại -> bị chặn cc_same
      const ccChangeSame = await callUpgrade({
        line_uid: aliceUid,
        session_token: aliceToken,
        action: 'cc_change',
        to: 'TH',
        pay: 'g'
      });
      assert.strictEqual(ccChangeSame.ok, false);
      assert.strictEqual(ccChangeSame.error, 'cc_same');

      // Chuyển sang quốc gia không hợp lệ -> cc_bad
      const ccChangeBad = await callUpgrade({
        line_uid: aliceUid,
        session_token: aliceToken,
        action: 'cc_change',
        to: 'INVALID',
        pay: 'g'
      });
      assert.strictEqual(ccChangeBad.ok, false);
      assert.strictEqual(ccChangeBad.error, 'cc_bad');

      // Reset cooldown của Alice và test thanh toán bằng Gold
      db.load();
      const pAlice = db.data.players.find(p => p.line_uid === aliceUid);
      const pAliceObj = JSON.parse(pAlice.raw_data);
      pAliceObj.cc_at = 0; // Hết cooldown
      pAlice.raw_data = JSON.stringify(pAliceObj);
      db.save();

      const ccChangeGold = await callUpgrade({
        line_uid: aliceUid,
        session_token: aliceToken,
        action: 'cc_change',
        to: 'PH',
        pay: 'g'
      });
      assert.strictEqual(ccChangeGold.ok, true);
      assert.strictEqual(ccChangeGold.player.country, 'PH');
      assert.strictEqual(ccChangeGold.player.gold, initialAlice.gold - 1000000, 'Trừ 1,000,000 Gold thành công');
    }

    // Bob không đủ tiền / đang cooldown / giờ chiến tranh -> bị chặn
    const bobCcChange = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'cc_change',
      to: 'VN',
      pay: 'g'
    });
    assert.strictEqual(bobCcChange.ok, false);
    console.log('  ✓ cc_list và cc_change hoạt động chính xác.');

    // --- TEST 2: archer_up ---
    console.log('\n▶ Test 2: Kiểm tra archer_up (Nâng cấp Cung thủ)...');
    const archerUp1 = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'archer_up'
    });
    assert.strictEqual(archerUp1.ok, true);
    assert.strictEqual(archerUp1.player.archer_lv, 2);
    assert.ok(archerUp1.player.gold < initialAlice.gold);
    assert.ok(archerUp1.player.stone < initialAlice.stone);
    assert.ok(archerUp1.player.copper < initialAlice.copper);

    // Bob không đủ tài nguyên
    const bobArcherUp = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'archer_up'
    });
    assert.strictEqual(bobArcherUp.ok, false);
    assert.ok(bobArcherUp.error.includes('Thiếu tài nguyên'));

    // Test max level 100
    db.load();
    const pAliceRow = db.data.players.find(p => p.line_uid === aliceUid);
    const pObjMax = JSON.parse(pAliceRow.raw_data);
    pObjMax.archer_lv = 100;
    pAliceRow.raw_data = JSON.stringify(pObjMax);
    db.save();

    const maxArcherUp = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'archer_up'
    });
    assert.strictEqual(maxArcherUp.ok, false);
    assert.ok(maxArcherUp.error.includes('tối đa'));
    console.log('  ✓ archer_up tính chi phí và giới hạn cấp chính xác.');

    // --- TEST 3: toggle_drone ---
    console.log('\n▶ Test 3: Kiểm tra toggle_drone (Bật/tắt Drone)...');
    // Bob chưa unlock drone -> bị chặn
    const bobDrone = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'toggle_drone',
      value: 1
    });
    assert.strictEqual(bobDrone.ok, false);
    assert.ok(bobDrone.error.includes('chưa được mở khóa'));

    // Alice đã có drone lv 1 -> bật tắt thành công
    const aliceDroneOff = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'toggle_drone',
      value: 0
    });
    assert.strictEqual(aliceDroneOff.ok, true);
    assert.strictEqual(aliceDroneOff.player.drone_enabled, 0);

    const aliceDroneOn = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'toggle_drone',
      value: 1
    });
    assert.strictEqual(aliceDroneOn.ok, true);
    assert.strictEqual(aliceDroneOn.player.drone_enabled, 1);
    console.log('  ✓ toggle_drone kiểm tra quyền mở khóa và cập nhật chuẩn xác.');

    // --- TEST 4: guard_set & guard_remove ---
    console.log('\n▶ Test 4: Kiểm tra guard_set & guard_remove (Lính canh nhà bằng trứng)...');
    // Alice đặt trứng thường mid: 10
    const setGuard1 = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_set',
      mid: 10,
      mvp: 0
    });
    assert.strictEqual(setGuard1.ok, true);
    const guards1 = Array.isArray(setGuard1.player.home_guards) ? setGuard1.player.home_guards : JSON.parse(setGuard1.player.home_guards);
    assert.strictEqual(guards1.length, 1);
    assert.strictEqual(guards1[0].id, 10);
    assert.strictEqual(guards1[0].mvp, 0);
    const eggs1 = typeof setGuard1.player.eggs === 'string' ? JSON.parse(setGuard1.player.eggs) : setGuard1.player.eggs;
    assert.strictEqual(eggs1['10'].n, 4, 'Trứng thường phải trừ 1');

    // Alice đặt trứng MVP mid: 10
    const setGuard2 = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_set',
      mid: 10,
      mvp: 1
    });
    assert.strictEqual(setGuard2.ok, true);
    const guards2 = Array.isArray(setGuard2.player.home_guards) ? setGuard2.player.home_guards : JSON.parse(setGuard2.player.home_guards);
    assert.strictEqual(guards2.length, 2);
    assert.strictEqual(guards2[1].mvp, 1);
    const eggs2 = typeof setGuard2.player.eggs === 'string' ? JSON.parse(setGuard2.player.eggs) : setGuard2.player.eggs;
    assert.strictEqual(eggs2['10'].m, 1, 'Trứng MVP phải trừ 1');

    // Đặt trứng không có trong kho -> bị chặn
    const setGuardFail = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_set',
      mid: 999,
      mvp: 0
    });
    assert.strictEqual(setGuardFail.ok, false);

    // Gỡ lính canh vị trí 0
    const removeGuard = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_remove',
      idx: 0
    });
    assert.strictEqual(removeGuard.ok, true);
    const guards3 = Array.isArray(removeGuard.player.home_guards) ? removeGuard.player.home_guards : JSON.parse(removeGuard.player.home_guards);
    assert.strictEqual(guards3.length, 1);

    // Gỡ vị trí không hợp lệ
    const removeGuardBad = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_remove',
      idx: 99
    });
    assert.strictEqual(removeGuardBad.ok, false);
    console.log('  ✓ guard_set và guard_remove quản lý kho trứng và slot lính canh chuẩn xác.');

    // --- TEST 5: job2_unlock ---
    console.log('\n▶ Test 5: Kiểm tra job2_unlock (Mở khóa cấp sao chuyên môn)...');
    // Bob level 20 < 60 -> bị chặn
    const bobJob2 = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'job2_unlock',
      tree: 'atk'
    });
    assert.strictEqual(bobJob2.ok, false);
    assert.ok(bobJob2.error.includes('cấp 60'));

    // Alice level 65, đủ exp cho atk -> mở khóa sao 1
    const aliceJob2 = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'job2_unlock',
      tree: 'atk'
    });
    assert.strictEqual(aliceJob2.ok, true);
    const stars = typeof aliceJob2.player.job2_star === 'string' ? JSON.parse(aliceJob2.player.job2_star) : aliceJob2.player.job2_star;
    assert.strictEqual(stars.atk, 1);
    const exps = typeof aliceJob2.player.job2_exp === 'string' ? JSON.parse(aliceJob2.player.job2_exp) : aliceJob2.player.job2_exp;
    assert.strictEqual(exps.atk, 100000000, 'Trừ 500,000,000 exp thành công');

    // Alice thử mở khóa tiếp khi exp không đủ -> bị chặn
    const aliceJob2NoExp = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'job2_unlock',
      tree: 'atk'
    });
    assert.strictEqual(aliceJob2NoExp.ok, false);
    console.log('  ✓ job2_unlock kiểm tra level và trừ điểm chuyên môn chính xác.');

    // --- TEST 6: vip_box_buy ---
    console.log('\n▶ Test 6: Kiểm tra vip_box_buy (Mua hộp VIP bằng Gold/P-points)...');
    // Alice mua 2 hộp card cấp 1 bằng Gold (2 * 100,000 = 200,000G)
    const buyBoxGold = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'vip_box_buy',
      kind: 'card',
      tier: 1,
      qty: 2,
      pay: 'g'
    });
    assert.strictEqual(buyBoxGold.ok, true);
    assert.strictEqual(buyBoxGold.player.card_box1, 2);

    // Alice mua 1 hộp egg cấp 2 bằng P (2 * 5 * 1 = 10 P)
    const prevP = aliceJob2.player.p_points || 500;
    const buyBoxP = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'vip_box_buy',
      kind: 'egg',
      tier: 2,
      qty: 1,
      pay: 'p'
    });
    assert.strictEqual(buyBoxP.ok, true);
    assert.strictEqual(buyBoxP.player.egg_box2, 1);
    assert.strictEqual(buyBoxP.player.p_points, prevP - 10);

    // Mua tier vượt quá VIP level (Bob VIP 0 mua tier 5 -> bị chặn)
    const bobBuyTier5 = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'vip_box_buy',
      kind: 'card',
      tier: 5,
      qty: 1,
      pay: 'g'
    });
    assert.strictEqual(bobBuyTier5.ok, false);

    // Bob không đủ tiền mua
    const bobBuyNoMoney = await callUpgrade({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'vip_box_buy',
      kind: 'card',
      tier: 1,
      qty: 1,
      pay: 'g'
    });
    assert.strictEqual(bobBuyNoMoney.ok, false);
    console.log('  ✓ vip_box_buy tính giá server-side và kiểm soát cấp VIP chính xác.');

    // --- TEST 7: araid_set ---
    console.log('\n▶ Test 7: Kiểm tra araid_set (Cài đặt Auto-Raid)...');
    const araidSet = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'araid_set',
      on: 1,
      g: 1,
      c: 0
    });
    assert.strictEqual(araidSet.ok, true);
    assert.strictEqual(araidSet.player.araid_on, 1);
    assert.strictEqual(araidSet.player.araid_g, 1);
    assert.strictEqual(araidSet.player.araid_c, 0);
    console.log('  ✓ araid_set cập nhật trạng thái Auto-Raid hoàn hảo.');

    // --- TEST 8: Security & Session Token Validation ---
    console.log('\n▶ Test 8: Kiểm tra bảo mật Session Token trên các action...');
    // Thiếu token
    const noToken = await callUpgrade({ line_uid: aliceUid, action: 'archer_up' });
    assert.strictEqual(noToken.ok, false);
    assert.ok(noToken.error.includes('Unauthorized'));

    // Token sai
    const fakeToken = await callUpgrade({ line_uid: aliceUid, session_token: 'fake_token_123', action: 'archer_up' });
    assert.strictEqual(fakeToken.ok, false);
    assert.strictEqual(fakeToken.error, 'Unauthorized: Invalid session_token');

    // Token của người khác (Alice UID + Bob token)
    const stolenToken = await callUpgrade({ line_uid: aliceUid, session_token: bobToken, action: 'cc_list' });
    assert.strictEqual(stolenToken.ok, false);
    assert.strictEqual(stolenToken.error, 'Unauthorized: Invalid session_token');
    console.log('  ✓ Chặn toàn bộ các request giả mạo / thiếu session_token.');

    // --- TEST 9: Concurrent / Double-Submit Safety ---
    console.log('\n▶ Test 9: Kiểm tra an toàn đa luồng / chống double submit...');
    const currentGold = buyBoxP.player.gold;
    const [c1, c2] = await Promise.all([
      callUpgrade({ line_uid: aliceUid, session_token: aliceToken, action: 'vip_box_buy', kind: 'card', tier: 1, qty: 1, pay: 'g' }),
      callUpgrade({ line_uid: aliceUid, session_token: aliceToken, action: 'vip_box_buy', kind: 'card', tier: 1, qty: 1, pay: 'g' })
    ]);
    assert.strictEqual(c1.ok, true);
    assert.strictEqual(c2.ok, true);
    // Cả 2 request tuần tự trừ đúng 200,000 Gold tổng cộng
    db.load();
    const pFinal = db.data.players.find(p => p.line_uid === aliceUid);
    const pFinalObj = JSON.parse(pFinal.raw_data);
    assert.strictEqual(pFinalObj.gold, currentGold - 200000);
    assert.strictEqual(pFinalObj.card_box1, 4); // 2 từ test 6 + 2 từ test 9
    console.log('  ✓ Đa luồng xử lý an toàn dưới acquireLock.');

    // --- TEST 10: Atomic Rollback Simulation on DB Save Failure ---
    console.log('\n▶ Test 10: Giả lập lỗi I/O db.save cho cc_change, guard_set, vip_box_buy...');
    const originalSave = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk error during upgrade'); };

    const rollbackCc = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'cc_change',
      to: 'BR',
      pay: 'g'
    });
    assert.strictEqual(rollbackCc.ok, false, 'Khi db.save lỗi, cc_change phải trả về ok: false');

    const rollbackGuard = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'guard_set',
      mid: 10,
      mvp: 0
    });
    assert.strictEqual(rollbackGuard.ok, false, 'Khi db.save lỗi, guard_set phải trả về ok: false');

    const rollbackBox = await callUpgrade({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'vip_box_buy',
      kind: 'module',
      tier: 1,
      qty: 1,
      pay: 'g'
    });
    assert.strictEqual(rollbackBox.ok, false, 'Khi db.save lỗi, vip_box_buy phải trả về ok: false');

    db.save = originalSave;
    db.load();
    const pCheck = db.data.players.find(p => p.line_uid === aliceUid);
    const pCheckObj = JSON.parse(pCheck.raw_data);
    assert.notStrictEqual(pCheckObj.country, 'BR', 'Quốc gia không được đổi khi save thất bại');
    assert.strictEqual(pCheckObj.module_box1 || 0, 0, 'Hộp không được cấp khi save thất bại');
    console.log('  ✓ Rollback snapshot nguyên tử khi lỗi đĩa thành công 100%.');

    console.log('\n🎉 TẤT CẢ 10 BỘ KIỂM THỬ HỆ THỐNG UPGRADE ĐỀU ĐẠT CHUẨN (PASS 100%)!');
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

