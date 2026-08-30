const assert = require('assert');
const db = require('../server/db/queries');
const chatRoute = require('../server/routes/chat');

console.log('🧪 Bắt đầu kiểm thử toàn diện hệ thống Trò chuyện & Bảo mật Session (TASK-023)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_alice_') || uid.startsWith('test_bob_') || uid.startsWith('test_charlie_') || uid.startsWith('test_chat_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.chat_messages)) {
        db.data.chat_messages = db.data.chat_messages.filter(m => !isTestUid(m.u) && !isTestUid(m.to_uid));
      }
      db.save();
    }
  } catch (err) {
    console.error('Lỗi khi cleanup database:', err);
  }
}

function callChat(body) {
  return new Promise((resolve) => {
    chatRoute.handle(
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
  const aliceToken = 'tok_a_' + uniqueSuffix;
  const bobToken = 'tok_b_' + uniqueSuffix;
  const charlieToken = 'tok_c_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid, charlieUid];

  cleanupTestRecords(testUids);

  try {
    const initialAlice = {
      line_uid: aliceUid,
      name: 'Alice Chat',
      lv: 45,
      rag_lv: 2,
      vip_lv: 1,
      guild_id: 10,
      guild_tag: 'Dragon|1:1:1',
      country: 'VN',
      last_cc: 'VN',
      map: 2
    };

    const initialBob = {
      line_uid: bobUid,
      name: 'Bob Chat',
      lv: 50,
      rag_lv: 5,
      vip_lv: 3,
      guild_id: 10,
      guild_tag: 'Dragon|1:1:1',
      country: 'TH',
      last_cc: 'TH',
      map: 3
    };

    const initialCharlie = {
      line_uid: charlieUid,
      name: 'Charlie Chat',
      lv: 20,
      rag_lv: 0,
      vip_lv: 0,
      guild_id: 0,
      guild_tag: '',
      country: 'PH',
      last_cc: 'PH',
      map: 1
    };

    // Tạo users & players
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, initialAlice.name, JSON.stringify(initialAlice)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, initialBob.name, JSON.stringify(initialBob)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      charlieUid, 'charlie_' + uniqueSuffix, 'hash', charlieToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      charlieUid, initialCharlie.name, JSON.stringify(initialCharlie)
    );

    // --- TEST 1: Global Chat Send & Fetch ---
    console.log('\n▶ Test 1: Kiểm tra gửi và tải tin nhắn kênh Toàn cầu (Global)...');
    const sendGlobal = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      message: 'Xin chào toàn server!'
    });
    assert.strictEqual(sendGlobal.ok, true, 'Gửi global phải thành công');

    const fetchGlobal = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'fetch',
      room: ''
    });
    assert.strictEqual(fetchGlobal.ok, true);
    assert.strictEqual(fetchGlobal.me, aliceUid, 'Field me phải là line_uid người gọi');
    assert.ok(Array.isArray(fetchGlobal.msgs));
    const aliceMsg = fetchGlobal.msgs.find(m => m.u === aliceUid && m.m === 'Xin chào toàn server!');
    assert.ok(aliceMsg, 'Phải tìm thấy tin nhắn của Alice');
    assert.strictEqual(aliceMsg.n, 'Alice Chat');
    assert.strictEqual(aliceMsg.cc, 'VN');
    assert.strictEqual(aliceMsg.lv, 45);

    const bobFetchGlobal = await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'fetch'
    });
    assert.strictEqual(bobFetchGlobal.me, bobUid);
    assert.ok(bobFetchGlobal.msgs.some(m => m.u === aliceUid));
    console.log('  ✓ Gửi và tải tin nhắn Global hoạt động hoàn hảo.');

    // --- TEST 2: Guild Chat Authorization ---
    console.log('\n▶ Test 2: Kiểm tra phân quyền và trò chuyện Bang hội (Guild Chat)...');
    // Charlie chưa vào guild gửi -> bị chặn
    const charlieGuildSend = await callChat({
      line_uid: charlieUid,
      session_token: charlieToken,
      action: 'send',
      room: 'guild',
      message: 'Tôi muốn chat guild'
    });
    assert.strictEqual(charlieGuildSend.ok, false);
    assert.strictEqual(charlieGuildSend.error, 'no_guild');

    // Charlie chưa vào guild fetch -> bị chặn
    const charlieGuildFetch = await callChat({
      line_uid: charlieUid,
      session_token: charlieToken,
      action: 'fetch',
      room: 'guild'
    });
    assert.strictEqual(charlieGuildFetch.ok, false);
    assert.strictEqual(charlieGuildFetch.error, 'no_guild');

    // Alice (Guild 10) gửi tin nhắn bang
    const aliceGuildSend = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      room: 'guild',
      message: 'Chào các bạn bang Dragon!'
    });
    assert.strictEqual(aliceGuildSend.ok, true);

    // Bob (Guild 10) xem được tin nhắn bang
    const bobGuildFetch = await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'fetch',
      room: 'guild'
    });
    assert.strictEqual(bobGuildFetch.ok, true);
    assert.ok(bobGuildFetch.msgs.some(m => m.u === aliceUid && m.m === 'Chào các bạn bang Dragon!'));
    console.log('  ✓ Phân quyền và gửi/nhận tin nhắn Guild chính xác 100%.');

    // --- TEST 3: DM Send, Fetch, Unread Count & Read State ---
    console.log('\n▶ Test 3: Kiểm tra Tin nhắn riêng (DM), danh sách DMs và cập nhật trạng thái đã đọc...');
    // Alice gửi DM cho Bob
    const aliceDmBob = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      to: bobUid,
      message: 'Hôm nay săn Boss không Bob?'
    });
    assert.strictEqual(aliceDmBob.ok, true);

    // Bob kiểm tra danh sách dms -> thấy Alice với n = 1
    const bobDms1 = await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'dms'
    });
    assert.strictEqual(bobDms1.ok, true);
    assert.ok(Array.isArray(bobDms1.dms));
    const aliceConv = bobDms1.dms.find(d => d.uid === aliceUid);
    assert.ok(aliceConv, 'Bob phải thấy hội thoại với Alice trong dms');
    assert.strictEqual(aliceConv.name, 'Alice Chat');
    assert.strictEqual(aliceConv.last, 'Hôm nay săn Boss không Bob?');
    assert.strictEqual(aliceConv.n, 1, 'Số tin nhắn chưa đọc phải là 1');

    // Bob fetch tin nhắn riêng với Alice -> cập nhật đã đọc
    const bobFetchDm = await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'fetch',
      with: aliceUid
    });
    assert.strictEqual(bobFetchDm.ok, true);
    assert.ok(bobFetchDm.msgs.some(m => m.m === 'Hôm nay săn Boss không Bob?'));

    // Bob kiểm tra lại danh sách dms -> n = 0
    const bobDms2 = await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'dms'
    });
    const aliceConv2 = bobDms2.dms.find(d => d.uid === aliceUid);
    assert.strictEqual(aliceConv2.n, 0, 'Sau khi fetch, số tin nhắn chưa đọc phải là 0');
    console.log('  ✓ Gửi DM, unread badge và cập nhật read state hoạt động chuẩn xác.');

    // --- TEST 4: Chặn DM chính mình và người không tồn tại ---
    console.log('\n▶ Test 4: Kiểm tra chặn DM chính mình & người nhận không tồn tại...');
    const selfDm = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      to: aliceUid,
      message: 'Tự nói chuyện'
    });
    assert.strictEqual(selfDm.ok, false);
    assert.strictEqual(selfDm.error, 'self_dm');

    const notFoundDm = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      to: 'invalid_recipient_uid',
      message: 'Alo có ai không?'
    });
    assert.strictEqual(notFoundDm.ok, false);
    assert.strictEqual(notFoundDm.error, 'not_found');
    console.log('  ✓ Chặn DM chính mình và người không tồn tại thành công.');

    // --- TEST 5: Duplicate Message Suppression ---
    console.log('\n▶ Test 5: Kiểm tra cơ chế chống gửi tin nhắn trùng lặp (Duplicate Suppression)...');
    const send1 = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      message: 'Tin nhắn kiểm tra trùng lặp'
    });
    assert.strictEqual(send1.ok, true);

    const send2 = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      message: 'Tin nhắn kiểm tra trùng lặp'
    });
    assert.strictEqual(send2.ok, true);
    assert.strictEqual(send2.dup, true, 'Tin nhắn thứ 2 phải trả về dup: true');
    console.log('  ✓ Chống spam tin nhắn trùng lặp hoạt động đúng hợp đồng client.');

    // --- TEST 6: Spam / Rate-Limit Protection ---
    console.log('\n▶ Test 6: Kiểm tra giới hạn tần suất gửi tin nhắn (Rate-Limit)...');
    let hitRateLimit = false;
    for (let i = 0; i < 15; i++) {
      const r = await callChat({
        line_uid: charlieUid,
        session_token: charlieToken,
        action: 'send',
        message: 'Spam nhanh ' + i
      });
      if (r && r.error === 'rate_limit') {
        hitRateLimit = true;
        break;
      }
    }
    assert.strictEqual(hitRateLimit, true, 'Phải kích hoạt rate_limit khi gửi quá nhanh');
    console.log('  ✓ Rate limit chặn spam thành công.');

    // --- TEST 7: Content Sanitization & Length Limit ---
    console.log('\n▶ Test 7: Kiểm tra làm sạch văn bản & giới hạn 200 ký tự...');
    const longText = 'A'.repeat(250) + '\x00\x08';
    await callChat({
      line_uid: bobUid,
      session_token: bobToken,
      action: 'send',
      message: longText
    });
    const bobGlobal = await callChat({ line_uid: bobUid, session_token: bobToken, action: 'fetch' });
    const lastBobMsg = bobGlobal.msgs[bobGlobal.msgs.length - 1];
    assert.ok(lastBobMsg.m.length <= 200, 'Nội dung tin nhắn không được vượt quá 200 ký tự');
    assert.strictEqual(lastBobMsg.m.includes('\x00'), false, 'Không được chứa ký tự điều khiển nguy hiểm');
    console.log('  ✓ Sanitize và cắt độ dài tin nhắn thành công.');

    // --- TEST 8: Image Report Handling ---
    console.log('\n▶ Test 8: Kiểm tra xử lý báo cáo hình ảnh (report_img)...');
    const invalidImgReport = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'report_img',
      img: 'not_a_valid_hex'
    });
    assert.strictEqual(invalidImgReport.ok, false);
    assert.strictEqual(invalidImgReport.error, 'invalid_image');

    const validImgReport = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'report_img',
      img: 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    });
    assert.strictEqual(validImgReport.ok, false);
    assert.ok(validImgReport.error === 'image_not_found' || validImgReport.error === 'storage_unavailable');
    console.log('  ✓ Báo cáo ảnh xử lý an toàn và trung thực.');

    // --- TEST 9: Persistence & Database Reload ---
    console.log('\n▶ Test 9: Kiểm tra tính bền vững dữ liệu sau khi nạp lại Database...');
    db.load();
    const reloadFetch = await callChat({ line_uid: aliceUid, session_token: aliceToken, action: 'fetch' });
    assert.strictEqual(reloadFetch.ok, true);
    assert.ok(reloadFetch.msgs.length > 0, 'Dữ liệu tin nhắn phải tồn tại sau khi load database');
    console.log('  ✓ Dữ liệu chat bền vững qua các lần reload.');

    // --- TEST 10: Atomic Rollback Simulation on DB Save Failure ---
    console.log('\n▶ Test 10: Giả lập lỗi I/O db.save trong quá trình gửi tin nhắn (Rollback)...');
    const originalSave = db.save.bind(db);
    db.save = () => { throw new Error('Simulated disk error during chat send'); };

    const failSend = await callChat({
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'send',
      message: 'Tin nhắn sẽ bị lỗi đĩa'
    });
    db.save = originalSave;

    assert.strictEqual(failSend.ok, false, 'Khi db.save lỗi, gửi tin nhắn phải trả về ok: false');
    db.load();
    const checkFailedMsg = (db.data.chat_messages || []).find(m => m.m === 'Tin nhắn sẽ bị lỗi đĩa');
    assert.strictEqual(checkFailedMsg, undefined, 'Tin nhắn thất bại không được lưu vào cơ sở dữ liệu');
    console.log('  ✓ Rollback nguyên tử khi lỗi đĩa thành công 100%.');

    // --- TEST 11: Security & Session Token Validation ---
    console.log('\n▶ Test 11: Kiểm tra bảo mật Session Token (Chặn mạo danh / Forged UID / Token sai)...');
    
    // 11.1 Thiếu session_token
    const noTokenFetch = await callChat({ line_uid: aliceUid, action: 'fetch' });
    assert.strictEqual(noTokenFetch.ok, false, 'Thiếu session_token phải bị từ chối');
    assert.ok(noTokenFetch.error.includes('Unauthorized'), 'Error phải báo Unauthorized');

    const noTokenSend = await callChat({ line_uid: aliceUid, action: 'send', message: 'Hacker send' });
    assert.strictEqual(noTokenSend.ok, false, 'Send thiếu session_token phải bị từ chối');

    const noTokenDms = await callChat({ line_uid: aliceUid, action: 'dms' });
    assert.strictEqual(noTokenDms.ok, false, 'DMs thiếu session_token phải bị từ chối');

    const noTokenReport = await callChat({ line_uid: aliceUid, action: 'report_img', img: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    assert.strictEqual(noTokenReport.ok, false, 'Report img thiếu session_token phải bị từ chối');

    // 11.2 Sai session_token
    const fakeTokenFetch = await callChat({ line_uid: aliceUid, session_token: 'forged_fake_token_123', action: 'fetch' });
    assert.strictEqual(fakeTokenFetch.ok, false, 'Fake token phải bị từ chối');
    assert.strictEqual(fakeTokenFetch.error, 'Unauthorized: Invalid session_token');

    // 11.3 Dùng token của người khác (Alice UID nhưng dùng Bob token)
    const hijackedTokenFetch = await callChat({ line_uid: aliceUid, session_token: bobToken, action: 'fetch' });
    assert.strictEqual(hijackedTokenFetch.ok, false, 'Dùng token của người khác phải bị từ chối');
    assert.strictEqual(hijackedTokenFetch.error, 'Unauthorized: Invalid session_token');

    const hijackedTokenSend = await callChat({ line_uid: aliceUid, session_token: bobToken, action: 'send', message: 'Mạo danh' });
    assert.strictEqual(hijackedTokenSend.ok, false, 'Mạo danh gửi tin nhắn phải bị từ chối');
    console.log('  ✓ Toàn bộ các hành vi mạo danh UID, thiếu token, token sai đều bị chặn triệt để.');

    console.log('\n🎉 TẤT CẢ 11 BỘ KIỂM THỬ HỆ THỐNG CHAT & BẢO MẬT ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

