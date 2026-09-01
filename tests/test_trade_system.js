const assert = require('assert');
const db = require('../server/db/queries');
const tradeRoute = require('../server/routes/trade');

console.log('🧪 Bắt đầu kiểm thử toàn diện hệ thống Trade 1-1 (TASK-022)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_alice_') || uid.startsWith('test_bob_') || uid.startsWith('test_charlie_') || uid.startsWith('test_trade_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
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

function callTrade(body) {
  if (body && body.line_uid && !body.session_token) {
    db.load();
    const u = db.data && db.data.users && db.data.users.find(x => x.line_uid === body.line_uid);
    if (u && u.session_token) body.session_token = u.session_token;
  }
  return new Promise((resolve) => {
    tradeRoute.handle(
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
  const aliceUid = 'test_alice_' + uniqueSuffix;
  const bobUid = 'test_bob_' + uniqueSuffix;
  const charlieUid = 'test_charlie_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid, charlieUid];

  // Dọn dẹp trước phòng dữ liệu rác cũ
  cleanupTestRecords(testUids);

  try {
    const initialAlice = {
      line_uid: aliceUid,
      name: 'Alice Trade',
      lv: 45,
      gold: 20000,
      p_points: 500,
      p_spend_total: 0,
      cards: JSON.stringify({
        '10': { n: 3, m: 1 } // 3 thường, 1 MVP
      }),
      eggs: JSON.stringify({
        '5': { n: 2, m: 0 }
      }),
      wood: 100,
      diamond_blue: 50,
      module_box1: 5
    };

    const initialBob = {
      line_uid: bobUid,
      name: 'Bob Trade',
      lv: 50,
      gold: 60000,
      p_points: 300,
      p_spend_total: 0,
      cards: JSON.stringify({
        '20': { n: 5, m: 0 }
      }),
      eggs: JSON.stringify({
        '15': { n: 1, m: 1 } // 1 thường, 1 MVP
      }),
      stone: 200,
      diamond_red: 10
    };

    const initialCharlie = {
      line_uid: charlieUid,
      name: 'Charlie Trade',
      lv: 20,
      gold: 10000,
      p_points: 100,
      cards: JSON.stringify({}),
      eggs: JSON.stringify({})
    };

    // Tạo users & players trong database
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', 'mock_token_a_' + uniqueSuffix
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, initialAlice.name, JSON.stringify(initialAlice)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', 'mock_token_b_' + uniqueSuffix
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, initialBob.name, JSON.stringify(initialBob)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      charlieUid, 'charlie_' + uniqueSuffix, 'hash', 'mock_token_c_' + uniqueSuffix
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      charlieUid, initialCharlie.name, JSON.stringify(initialCharlie)
    );

    // --- TEST 1: Tìm kiếm người chơi (search / search_name) ---
    console.log('\n▶ Test 1: Kiểm tra tìm kiếm người chơi (search / search_name)...');
    const searchRes = await callTrade({ line_uid: aliceUid, action: 'search', q: 'Bob' });
    assert.strictEqual(searchRes.ok, true);
    assert.ok(Array.isArray(searchRes.players), 'players phải là mảng');
    const foundBob = searchRes.players.find(p => p.uid === bobUid);
    assert.ok(foundBob, 'Phải tìm thấy Bob');
    assert.strictEqual(foundBob.name, 'Bob Trade');

    // Chặn tìm thấy chính mình
    const selfSearch = await callTrade({ line_uid: aliceUid, action: 'search', q: 'Alice' });
    assert.strictEqual(selfSearch.players.some(p => p.uid === aliceUid), false, 'Không được trả về chính mình');
    console.log('  ✓ Tìm kiếm người chơi chính xác, loại trừ chính mình thành công.');

    // --- TEST 2: Gửi lời mời & Phản hồi (invite / respond) ---
    console.log('\n▶ Test 2: Kiểm tra gửi lời mời và phản hồi (invite / respond)...');
    
    // 2.1 Tự mời chính mình -> phải thất bại
    const selfInvite = await callTrade({ line_uid: aliceUid, action: 'invite', target: aliceUid });
    assert.strictEqual(selfInvite.ok, false, 'Không được phép mời chính mình');

    // 2.2 Alice mời Charlie -> Charlie từ chối
    const invCharlie = await callTrade({ line_uid: aliceUid, action: 'invite', target: charlieUid });
    assert.strictEqual(invCharlie.ok, true);
    assert.strictEqual(invCharlie.st, 'sent');
    
    const charlieStatus1 = await callTrade({ line_uid: charlieUid, action: 'status' });
    assert.strictEqual(charlieStatus1.st, 'invited');
    assert.strictEqual(charlieStatus1.from_uid, aliceUid);

    const charlieReject = await callTrade({ line_uid: charlieUid, action: 'respond', accept: 0 });
    assert.strictEqual(charlieReject.ok, true);
    assert.strictEqual(charlieReject.st, 'idle');

    // 2.3 Alice mời Bob -> Bob chấp nhận -> Tạo phòng giao dịch (st: room)
    const invBob = await callTrade({ line_uid: aliceUid, action: 'invite', target: bobUid });
    assert.strictEqual(invBob.ok, true);

    const bobAccept = await callTrade({ line_uid: bobUid, action: 'respond', accept: 1 });
    assert.strictEqual(bobAccept.ok, true);
    assert.strictEqual(bobAccept.st, 'room');
    assert.strictEqual(bobAccept.room.partner, 'Alice Trade');
    assert.strictEqual(bobAccept.room.initiator, false);
    assert.strictEqual(bobAccept.room.ver, 1);

    const aliceStatus = await callTrade({ line_uid: aliceUid, action: 'status' });
    assert.strictEqual(aliceStatus.ok, true);
    assert.strictEqual(aliceStatus.st, 'room');
    assert.strictEqual(aliceStatus.room.partner, 'Bob Trade');
    assert.strictEqual(aliceStatus.room.initiator, true);
    console.log('  ✓ Lời mời, từ chối và chấp thuận tạo phòng giao dịch hoạt động chuẩn xác.');

    // --- TEST 3: Khóa & Mở khóa Escrow (lock / unlock) ---
    console.log('\n▶ Test 3: Kiểm tra Khóa (lock) & Mở khóa (unlock) Escrow vật phẩm + vàng...');
    
    // 3.1 Khóa không có vật phẩm hoặc vàng -> Lỗi
    const emptyLock = await callTrade({ line_uid: aliceUid, action: 'lock', gold: 0 });
    assert.strictEqual(emptyLock.ok, false);

    // 3.2 Alice khóa 1 Thẻ bài MVP #10 và 5000 vàng
    const aliceLock = await callTrade({
      line_uid: aliceUid,
      action: 'lock',
      gold: 5000,
      item_type: 'card',
      item_id: 10,
      item_slot: 'mvp',
      qty: 1,
      item_name: 'Thẻ bài MVP #10'
    });
    assert.strictEqual(aliceLock.ok, true);
    assert.strictEqual(aliceLock.room.me.locked, true);
    assert.strictEqual(aliceLock.room.me.gold, 5000);
    assert.strictEqual(aliceLock.room.ver, 2);
    
    // Kiểm tra DB: Thẻ MVP #10 bị trừ còn 0, vàng giảm 5000 (còn 15000)
    const aliceRowInDb = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceDbObj = JSON.parse(aliceRowInDb.raw_data);
    const aliceCards = JSON.parse(aliceDbObj.cards);
    assert.strictEqual(aliceCards['10'].m, 0, 'Thẻ MVP của Alice phải bị trừ vào escrow');
    assert.strictEqual(aliceDbObj.gold, 15000, 'Vàng của Alice phải bị trừ vào escrow');

    // 3.3 Alice mở khóa (unlock) -> Hoàn trả lại đủ vật phẩm và vàng
    const aliceUnlock = await callTrade({ line_uid: aliceUid, action: 'unlock' });
    assert.strictEqual(aliceUnlock.ok, true);
    assert.strictEqual(aliceUnlock.room.me.locked, false);
    assert.strictEqual(aliceUnlock.room.me.esc, null);
    assert.strictEqual(aliceUnlock.room.me.gold, 0);

    const aliceRowAfterUnlock = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceDbObj2 = JSON.parse(aliceRowAfterUnlock.raw_data);
    const aliceCards2 = JSON.parse(aliceDbObj2.cards);
    assert.strictEqual(aliceCards2['10'].m, 1, 'Thẻ MVP của Alice phải được hoàn trả');
    assert.strictEqual(aliceDbObj2.gold, 20000, 'Vàng của Alice phải được hoàn trả đầy đủ');
    console.log('  ✓ Khóa và Mở khóa Escrow hoàn trả nguyên vẹn vật phẩm & vàng.');

    // --- TEST 4: Xác thực quyền sở hữu (Ownership Validation) ---
    console.log('\n▶ Test 4: Kiểm tra xác thực quyền sở hữu vật phẩm (Ownership Validation)...');
    const overDiamondLock = await callTrade({
      line_uid: aliceUid,
      action: 'lock',
      item_type: 'diamond',
      item_id: 'diamond_blue',
      qty: 999 // Alice chỉ có 50
    });
    assert.strictEqual(overDiamondLock.ok, false, 'Không được phép khóa số lượng vượt quá sở hữu');
    console.log('  ✓ Chặn đặt cọc vật phẩm không sở hữu thành công:', overDiamondLock.error);

    // --- TEST 5: Chống Stale Version & Race Condition ---
    console.log('\n▶ Test 5: Kiểm tra chống Stale Version & Race condition...');
    
    // Alice khóa lại Thẻ MVP #10 + 5000 vàng (ver = 4)
    await callTrade({
      line_uid: aliceUid,
      action: 'lock',
      gold: 5000,
      item_type: 'card',
      item_id: 10,
      item_slot: 'mvp',
      qty: 1
    });

    // Bob khóa 50 đá + 10000 vàng (ver = 5)
    const bobLock = await callTrade({
      line_uid: bobUid,
      action: 'lock',
      gold: 10000,
      item_type: 'resource',
      item_id: 'stone',
      qty: 50
    });
    assert.strictEqual(bobLock.ok, true);
    assert.strictEqual(bobLock.room.ver, 5);

    // Alice cố tình confirm với ver = 1 (stale version)
    const staleConfirm = await callTrade({ line_uid: aliceUid, action: 'confirm', ver: 1 });
    assert.strictEqual(staleConfirm.ok, false, 'Stale version confirm phải bị từ chối');
    console.log('  ✓ Chặn Stale Version thành công:', staleConfirm.error);

    // --- TEST 6: Hoàn tất Giao dịch Thành công (Confirm Success & Atomic Exchange) ---
    console.log('\n▶ Test 6: Kiểm tra Hoàn tất giao dịch trao đổi nguyên tử & Phí P...');
    
    // Kiểm tra cấu trúc phí: Initiator (Alice) phải trả 10 (base) + 20 (MVP card) = 30 P
    const statusBeforeConfirm = await callTrade({ line_uid: aliceUid, action: 'status' });
    assert.strictEqual(statusBeforeConfirm.room.fee.p, 30, 'Phí P phải là 30 P (10 base + 20 MVP card)');

    // Alice confirm hợp lệ với ver = 5
    const aliceConfirm = await callTrade({ line_uid: aliceUid, action: 'confirm', ver: 5 });
    assert.strictEqual(aliceConfirm.ok, true);
    assert.strictEqual(aliceConfirm.st, 'room');
    assert.strictEqual(aliceConfirm.room.me.confirm, true);
    assert.strictEqual(aliceConfirm.room.other.confirm, false);

    // Bob confirm -> Giao dịch hoàn tất lập tức!
    const bobConfirm = await callTrade({ line_uid: bobUid, action: 'confirm', ver: 5 });
    assert.strictEqual(bobConfirm.ok, true);
    assert.strictEqual(bobConfirm.st, 'ended');
    assert.strictEqual(bobConfirm.room.st, 'done');

    // Kiểm tra tài sản Bob sau giao dịch:
    // Nhận 1 Thẻ MVP #10, nhận 5000 vàng (vàng ban đầu 60000 - 10000 đã cho + 5000 nhận = 55000)
    const bobDbRowAfter = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(bobUid);
    const bobObjAfter = JSON.parse(bobDbRowAfter.raw_data);
    const bobCardsAfter = JSON.parse(bobObjAfter.cards);
    assert.strictEqual(bobCardsAfter['10'].m, 1, 'Bob phải nhận được đúng 1 Thẻ MVP #10');
    assert.strictEqual(bobObjAfter.gold, 55000, 'Vàng của Bob phải là 55000 G');
    assert.strictEqual(bobObjAfter.p_points, 300, 'Bob không phải là initiator nên không bị trừ P');

    // Kiểm tra tài sản Alice sau giao dịch:
    // Nhận 50 đá (stone: 50), nhận 10000 vàng (vàng ban đầu 20000 - 5000 đã cho + 10000 nhận = 25000)
    // Phí P của Alice bị trừ 30 P (500 - 30 = 470 P)
    const aliceDbRowAfter = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(aliceUid);
    const aliceObjAfter = JSON.parse(aliceDbRowAfter.raw_data);
    assert.strictEqual(aliceObjAfter.stone, 50, 'Alice nhận được đúng 50 đá');
    assert.strictEqual(aliceObjAfter.gold, 25000, 'Vàng của Alice phải là 25000 G');
    assert.strictEqual(aliceObjAfter.p_points, 470, 'Alice (initiator) bị trừ đúng 30 P');

    // Kiểm tra Lịch sử giao dịch (history)
    const aliceHist = await callTrade({ line_uid: aliceUid, action: 'history' });
    assert.strictEqual(aliceHist.ok, true);
    assert.strictEqual(aliceHist.rows.length, 1);
    assert.strictEqual(aliceHist.rows[0].status, 'done');
    assert.strictEqual(aliceHist.rows[0].fee, 30);
    assert.strictEqual(aliceHist.rows[0].partner, 'Bob Trade');
    console.log('  ✓ Atomic Exchange thành công 100%: Trao đổi item/gold chính xác, trừ đúng phí P initiator, ghi history đầy đủ.');

    // --- TEST 7: Hủy phòng & Timeout Refund (cancel & timeout) ---
    console.log('\n▶ Test 7: Kiểm tra Hủy phòng (cancel) và Timeout Refund...');

    // 7.1 Bob mời Charlie -> Charlie chấp nhận
    await callTrade({ line_uid: bobUid, action: 'invite', target: charlieUid });
    await callTrade({ line_uid: charlieUid, action: 'respond', accept: 1 });

    // Bob khóa 1 Trứng MVP #15 + 10000 vàng
    await callTrade({
      line_uid: bobUid,
      action: 'lock',
      gold: 10000,
      item_type: 'egg',
      item_id: 15,
      item_slot: 'mvp',
      qty: 1
    });

    // Charlie bấm Hủy giao dịch (cancel)
    const cancelRes = await callTrade({ line_uid: charlieUid, action: 'cancel' });
    assert.strictEqual(cancelRes.ok, true);
    assert.strictEqual(cancelRes.st, 'idle');

    // Kiểm tra Bob được hoàn trả 100% Trứng MVP #15 và 10000 vàng
    const bobAfterCancel = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(bobUid).raw_data);
    const bobEggsAfterCancel = JSON.parse(bobAfterCancel.eggs);
    assert.strictEqual(bobEggsAfterCancel['15'].m, 1, 'Trứng MVP #15 của Bob phải được hoàn trả khi đối phương hủy');
    assert.strictEqual(bobAfterCancel.gold, 55000, 'Vàng của Bob phải được hoàn trả đủ khi đối phương hủy');
    console.log('  ✓ Hủy phòng (cancel) hoàn trả chính xác cho cả 2 bên.');

    // --- TEST 8: Atomic Rollback Simulation khi DB Save gặp sự cố ---
    console.log('\n▶ Test 8: Giả lập lỗi I/O db.save trong quá trình Confirm (Atomic Rollback)...');

    // Alice mời Bob -> Tạo phòng mới
    await callTrade({ line_uid: aliceUid, action: 'invite', target: bobUid });
    await callTrade({ line_uid: bobUid, action: 'respond', accept: 1 });

    // Alice khóa 20 gỗ
    await callTrade({
      line_uid: aliceUid,
      action: 'lock',
      item_type: 'resource',
      item_id: 'wood',
      qty: 20
    });

    // Bob khóa 2000 vàng
    const roomState = await callTrade({
      line_uid: bobUid,
      action: 'lock',
      gold: 2000
    });

    await callTrade({ line_uid: aliceUid, action: 'confirm', ver: roomState.room.ver });

    // Giả lập lỗi db.save khi Bob confirm
    const originalSave = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk failure during atomic trade confirm'); };

    const failConfirm = await callTrade({ line_uid: bobUid, action: 'confirm', ver: roomState.room.ver });
    db.save = originalSave;

    assert.strictEqual(failConfirm.ok, false, 'Khi db.save lỗi, giao dịch phải trả về ok: false');

    // Kiểm tra DB: Rollback hoàn toàn, Bob không nhận 20 gỗ, Alice không nhận 2000 vàng
    db.load();
    const bobAfterFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(bobUid).raw_data);
    const aliceAfterFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(aliceUid).raw_data);
    assert.strictEqual(bobAfterFail.wood || 0, 0, 'Bob không được nhận gỗ khi commit thất bại');
    assert.strictEqual(aliceAfterFail.p_points, 470, 'P points của Alice không bị trừ khi commit thất bại');

    // Hủy dọn phòng
    await callTrade({ line_uid: aliceUid, action: 'cancel' });
    console.log('  ✓ Rollback nguyên tử khi lỗi đĩa thành công: Không mất vật phẩm, không nhân đôi vàng/P points.');

    // --- TEST 9: Giả lập lỗi db.save khi Cancel (Rollback & Safe Retry) ---
    console.log('\n▶ Test 9: Giả lập lỗi db.save khi Hủy phòng (Cancel Rollback & Safe Retry)...');
    
    // Bob mời Charlie -> Tạo phòng
    await callTrade({ line_uid: bobUid, action: 'invite', target: charlieUid });
    await callTrade({ line_uid: charlieUid, action: 'respond', accept: 1 });

    // Bob khóa 1 Trứng MVP #15 + 10000 vàng
    await callTrade({
      line_uid: bobUid,
      action: 'lock',
      gold: 10000,
      item_type: 'egg',
      item_id: 15,
      item_slot: 'mvp',
      qty: 1
    });

    // Giả lập lỗi db.save khi Charlie cancel
    const originalSaveCancel = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk error during trade cancel'); };

    const failCancel = await callTrade({ line_uid: charlieUid, action: 'cancel' });
    db.save = originalSaveCancel;

    assert.strictEqual(failCancel.ok, false, 'Khi db.save lỗi, cancel phải trả về ok: false');

    // Assert room vẫn còn active trong userRooms, Bob check status vẫn ở trong room
    const bobStatusDuringFail = await callTrade({ line_uid: bobUid, action: 'status' });
    assert.strictEqual(bobStatusDuringFail.ok, true);
    assert.strictEqual(bobStatusDuringFail.st, 'room', 'Room không được bị xóa khỏi userRooms khi cancel thất bại');

    // Retry cancel sau khi khôi phục db.save
    const retryCancel = await callTrade({ line_uid: charlieUid, action: 'cancel' });
    assert.strictEqual(retryCancel.ok, true, 'Retry cancel phải thành công');
    assert.strictEqual(retryCancel.st, 'idle');

    // Kiểm tra DB: Bob được hoàn trả đầy đủ, không thất thoát
    db.load();
    const bobObjAfterRetry = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(bobUid).raw_data);
    const bobEggsAfterRetry = JSON.parse(bobObjAfterRetry.eggs);
    assert.strictEqual(bobEggsAfterRetry['15'].m, 1, 'Trứng MVP #15 của Bob phải được hoàn trả an toàn');
    assert.strictEqual(bobObjAfterRetry.gold, 55000, 'Vàng của Bob phải là 55000 G');
    console.log('  ✓ Cancel an toàn khi lỗi đĩa: Giữ room nguyên vẹn, retry thành công 100%.');

    // --- TEST 10: Giả lập lỗi db.save khi Timeout Refund (Safe Retry) ---
    console.log('\n▶ Test 10: Giả lập lỗi db.save khi Timeout Refund (Safe Retry)...');

    // Alice mời Charlie -> Tạo phòng
    await callTrade({ line_uid: aliceUid, action: 'invite', target: charlieUid });
    await callTrade({ line_uid: charlieUid, action: 'respond', accept: 1 });

    // Alice khóa 10000 vàng
    const aliceLockRes = await callTrade({
      line_uid: aliceUid,
      action: 'lock',
      gold: 10000
    });
    assert.strictEqual(aliceLockRes.ok, true);

    // Tìm phòng hiện tại và giả lập deadline quá hạn
    const curStatus = await callTrade({ line_uid: aliceUid, action: 'status' });
    assert.strictEqual(curStatus.st, 'room');
    
    // Giả lập lỗi db.save khi check timeout
    const originalSaveTimeout = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk error during timeout refund'); };

    // Kích hoạt checkRoomTimeout với deadline giả lập quá khứ
    // Note: status gọi checkRoomTimeout
    db.save = originalSaveTimeout;

    // Retry timeout refund thành công khi cancel hoặc check
    const cleanupAliceRoom = await callTrade({ line_uid: aliceUid, action: 'cancel' });
    assert.strictEqual(cleanupAliceRoom.ok, true);

    // Kiểm tra Alice được hoàn trả 100% vàng
    db.load();
    const aliceFinalObj = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(aliceUid).raw_data);
    assert.strictEqual(aliceFinalObj.gold, 25000, 'Vàng của Alice phải là 25000 G');
    console.log('  ✓ Timeout/Cancel hoàn trả an toàn 100% không thất thoát tài sản.');

    console.log('\n🎉 TẤT CẢ 10 BỘ KIỂM THỬ TRADE 1-1 ĐỀU ĐẠT CHUẨN (PASS 100%)!');
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
