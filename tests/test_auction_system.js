/**
 * tests/test_auction_system.js
 * Kiểm thử toàn diện hệ thống Đấu giá Server-Authoritative (TASK-043)
 * 
 * Kiểm tra các tính chất:
 * 1. Xác thực bảo mật: line_uid & session_token bắt buộc (HTTP 401 nếu thiếu hoặc sai).
 * 2. Action 'state': Đọc thông tin 6 slots (P×3, G×3), time bounds, phase, inc ladders, unique mids.
 * 3. Opening bid (n = 0): Mở bid đầu tiên với starting price, trừ tiền chính xác, ghi nhận leader.
 * 4. Stale price check (seen): Bị từ chối với moved: true nếu giá đã thay đổi.
 * 5. Outbid & Instant Refund: Người mới bị trừ đủ tiền; người cũ được HOÀN TIỀN NGAY LẬP TỨC 100%.
 * 6. Self-outbid: Người đang dẫn đầu tự nâng giá CHỈ PHẢI TRẢ PHẦN CHÊNH LỆCH (inc).
 * 7. Insufficient balance: Từ chối nếu thiếu P hoặc G; số dư không âm.
 * 8. Chống client tampering: Server tự tính toán giá authoritative, bỏ qua mọi dữ liệu giá từ client.
 * 9. Concurrency mutex lock: Nhiều request bid đồng thời được tuần tự hóa, bảo toàn hoàn tiền.
 * 10. Action 'hist': Lịch sử đặt giá minh bạch, cờ refunded được cập nhật chuẩn xác.
 * 11. Settlement Idempotency: Trao thẻ vào player.cards cho người thắng; kết toán lần 2 không lặp lại.
 * 12. Action 'prev': Đọc kết quả các vòng đấu trước.
 * 13. Dọn dẹp database sạch sẽ 100%.
 */

const assert = require('assert');
process.env.ADMIN_API_KEY = 'test_admin_secret_key';
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
  player.p_points = (player.p_points !== undefined && !isNaN(player.p_points)) ? parseInt(player.p_points, 10) : 500;
  player.gold = (player.gold !== undefined && !isNaN(player.gold)) ? parseInt(player.gold, 10) : 500000;
  return player;
}

function saveTestPlayer(pRow, playerObj) {
  pRow.gold = playerObj.gold;
  pRow.p_points = playerObj.p_points;
  if (playerObj.cards) pRow.cards = playerObj.cards;
  pRow.raw_data = JSON.stringify(playerObj);
  db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(pRow.raw_data, pRow.line_uid);
  db.save();
}

async function runAuctionTests() {
  console.log('🧪 Bắt đầu kiểm thử Hệ thống Đấu giá Server-Authoritative (TASK-043)...\n');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const user1Name = `auc_u1_${uniqueSuffix}`;
  const user2Name = `auc_u2_${uniqueSuffix}`;
  let uid1 = null, token1 = null;
  let uid2 = null, token2 = null;

  try {
    // Khởi tạo database sạch cho phiên kiểm thử
    db.load();
    delete db.data.auction_rounds;
    delete db.data.auction_bids;
    delete db.data.auction_history;
    db.save();
    // =========================================================================
    // PHẦN 1: XÁC THỰC BẢO MẬT (AUTH CHECK)
    // =========================================================================
    console.log('========================================');
    console.log('PHẦN 1: XÁC THỰC BẢO MẬT VÀ SESSION TOKEN');
    console.log('========================================');

    const noAuthRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'state' })
    });
    assert.strictEqual(noAuthRes.status, 401, 'Thiếu credentials phải trả về HTTP 401');
    console.log('  ✓ Request không có credentials bị từ chối 401.');

    const fakeAuthRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: 'fake_uid', session_token: 'fake_tok', action: 'state' })
    });
    assert.strictEqual(fakeAuthRes.status, 401, 'Credentials giả mạo phải trả về HTTP 401');
    console.log('  ✓ Request token giả mạo bị từ chối 401.');

    // Đăng ký 2 tài khoản kiểm thử
    const reg1 = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user1Name, password: 'password123' })
    }).then(r => r.json());
    uid1 = reg1.line_uid;
    token1 = reg1.session_token;

    const reg2 = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user2Name, password: 'password123' })
    }).then(r => r.json());
    uid2 = reg2.line_uid;
    token2 = reg2.session_token;
    console.log(`  ✓ Đăng ký thành công User 1 (${uid1}) và User 2 (${uid2}).`);

    // Khởi tạo số dư thử nghiệm P và G cho cả 2 người chơi
    db.load();
    const p1InitRow = db.data.players.find(p => p.line_uid === uid1);
    if (p1InitRow) {
      const p1Obj = unpackTestPlayer(p1InitRow);
      p1Obj.p_points = 1000;
      p1Obj.gold = 20000000;
      saveTestPlayer(p1InitRow, p1Obj);
    }
    const p2InitRow = db.data.players.find(p => p.line_uid === uid2);
    if (p2InitRow) {
      const p2Obj = unpackTestPlayer(p2InitRow);
      p2Obj.p_points = 1000;
      p2Obj.gold = 20000000;
      saveTestPlayer(p2InitRow, p2Obj);
    }

    // =========================================================================
    // PHẦN 2: ACTION 'STATE' (THÔNG TIN PHIÊN ĐẤU GIÁ HÀNG NGÀY)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 2: KIỂM THỬ ACTION STATE');
    console.log('========================================');

    // Gọi state lần đầu để khởi tạo round
    const stateInitRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'state' })
    });
    const stateInitData = await stateInitRes.json();
    assert.strictEqual(stateInitData.ok, true);

    // Mở rộng thời gian opens_at và ends_at để đảm bảo phase là 'open' trong lúc test
    db.load();
    const nowSec = Math.floor(Date.now() / 1000);
    const activeRound = db.data.auction_rounds[db.data.auction_rounds.length - 1];
    activeRound.opens_at = nowSec - 3600; // đã mở 1 tiếng trước
    activeRound.ends_at = nowSec + 3600;  // còn 1 tiếng nữa mới đóng
    activeRound.settled = false;
    db.save();
    db.save();

    const stateRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'state' })
    });
    assert.strictEqual(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.strictEqual(stateData.ok, true);
    assert.strictEqual(stateData.phase, 'open', 'Phase phải là open trong khung giờ đấu giá');
    assert.strictEqual(stateData.slots.length, 6, 'Phải có chính xác 6 slots');
    assert.strictEqual(stateData.slots[0].cur, 'P');
    assert.strictEqual(stateData.slots[1].cur, 'P');
    assert.strictEqual(stateData.slots[2].cur, 'P');
    assert.strictEqual(stateData.slots[3].cur, 'G');
    assert.strictEqual(stateData.slots[4].cur, 'G');
    assert.strictEqual(stateData.slots[5].cur, 'G');

    // Kiểm tra unique monster id trong 6 slots
    const mids = stateData.slots.map(s => s.mid);
    const uniqueMids = new Set(mids);
    assert.strictEqual(uniqueMids.size, 6, 'Cả 6 slots phải chứa 6 quái vật khác nhau (không trùng lặp)');
    console.log(`  ✓ State endpoint trả về chuẩn xác: 6 slots (P×3, G×3), phase=open, 6 unique cards.`);

    // =========================================================================
    // PHẦN 3: LƯỢT BID ĐẦU TIÊN (OPENING BID: N = 0)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 3: LƯỢT ĐẶT GIÁ ĐẦU TIÊN (OPENING BID)');
    console.log('========================================');

    db.load();
    const p1RowBefore = db.data.players.find(p => p.line_uid === uid1);
    const p1Before = unpackTestPlayer(p1RowBefore);
    const startPriceP = stateData.slots[0].start;

    const bid1Res = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 0,
        inc: 0,
        seen: startPriceP
      })
    });
    assert.strictEqual(bid1Res.status, 200);
    const bid1Data = await bid1Res.json();
    if (!bid1Data.ok) console.log('bid1Data error:', bid1Data);
    assert.strictEqual(bid1Data.ok, true);
    assert.strictEqual(bid1Data.cur, 'P');
    assert.strictEqual(bid1Data.bal, p1Before.p_points - startPriceP, 'Phải trừ đúng startPrice');

    // Kiểm tra slot state
    const stateAfterBid1 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'state' })
    }).then(r => r.json());
    const slot0AfterBid1 = stateAfterBid1.slots[0];
    assert.strictEqual(slot0AfterBid1.top, startPriceP);
    assert.strictEqual(slot0AfterBid1.n, 1);
    assert.strictEqual(slot0AfterBid1.mine, true);
    console.log(`  ✓ User 1 mở bid đầu tiên thành công: trừ ${startPriceP} P, top=${slot0AfterBid1.top}, n=1, mine=true.`);

    // =========================================================================
    // PHẦN 4: CHỐNG TRƯỢT GIÁ (STALE PRICE PROTECTION: SEEN)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 4: CHỐNG TRƯỢT GIÁ VỚI SEEN MISMATCH');
    console.log('========================================');

    // User 2 gửi request với seen cũ = 0 (trong khi top hiện tại là startPriceP)
    const staleBidRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid2,
        session_token: token2,
        action: 'bid',
        slot: 0,
        inc: 0,
        seen: 0 // Giá lệch
      })
    });
    const staleBidData = await staleBidRes.json();
    assert.strictEqual(staleBidData.ok, false);
    assert.strictEqual(staleBidData.moved, true, 'Giá lệch phải trả về moved: true');
    console.log('  ✓ Hệ thống từ chối chính xác khi giá đã bị thay đổi (moved: true).');

    // =========================================================================
    // PHẦN 5: OUTBID VÀ HOÀN TIỀN TỨC THÌ (INSTANT REFUND)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 5: OUTBID VÀ TỰ ĐỘNG HOÀN TIỀN TỨC THÌ');
    console.log('========================================');

    db.load();
    const p2RowBefore = db.data.players.find(p => p.line_uid === uid2);
    const p2Before = unpackTestPlayer(p2RowBefore);
    // Bước tăng giá đầu tiên của P là 1
    const pInc = 1;
    const user2BidPrice = slot0AfterBid1.top + pInc;

    const outbidRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid2,
        session_token: token2,
        action: 'bid',
        slot: 0,
        inc: 0, // inc ladder index 0 -> +1 P
        seen: slot0AfterBid1.top
      })
    });
    const outbidData = await outbidRes.json();
    assert.strictEqual(outbidData.ok, true);
    assert.strictEqual(outbidData.bal, p2Before.p_points - user2BidPrice, 'User 2 phải bị trừ đủ user2BidPrice');

    // Kiểm tra User 1 đã được HOÀN TIỀN NGAY LẬP TỨC vào Database
    db.load();
    const p1RowAfterRefund = db.data.players.find(p => p.line_uid === uid1);
    const p1AfterRefund = unpackTestPlayer(p1RowAfterRefund);
    assert.strictEqual(p1AfterRefund.p_points, p1Before.p_points, 'User 1 phải nhận lại 100% tiền đã bị outbid');
    console.log(`  ✓ User 2 outbid thành công (${user2BidPrice} P). User 1 được hoàn tiền tức thì: số dư phục hồi về ${p1AfterRefund.p_points} P.`);

    // =========================================================================
    // PHẦN 6: TỰ NÂNG GIÁ BẢN THÂN (CHỈ TRẢ PHẦN CHÊNH LỆCH)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 6: TỰ NÂNG GIÁ BẢN THÂN (SELF-OUTBID)');
    console.log('========================================');

    db.load();
    const p2RowBeforeSelf = db.data.players.find(p => p.line_uid === uid2);
    const p2BeforeSelf = unpackTestPlayer(p2RowBeforeSelf);
    // index 1 của P là 5 P
    const selfInc = 5;

    const selfBidRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid2,
        session_token: token2,
        action: 'bid',
        slot: 0,
        inc: 1, // index 1 -> +5 P
        seen: user2BidPrice
      })
    });
    const selfBidData = await selfBidRes.json();
    assert.strictEqual(selfBidData.ok, true);
    // User 2 chỉ bị trừ phần chênh lệch (5 P), KHÔNG bị trừ toàn bộ giá mới
    assert.strictEqual(selfBidData.bal, p2BeforeSelf.p_points - selfInc, 'User 2 tự nâng giá chỉ phải trả phần chênh lệch');
    console.log(`  ✓ User 2 đang dẫn đầu tự nâng giá: Chỉ bị trừ đúng phần chênh lệch (${selfInc} P).`);

    // =========================================================================
    // PHẦN 7: TỪ CHỐI KHI THIẾU TIỀN (INSUFFICIENT BALANCE)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 7: CHỐNG SỐ DƯ ÂM KHI THIẾU TIỀN');
    console.log('========================================');

    // Chỉnh số dư vàng G của User 1 xuống 0
    db.load();
    const p1RowNoGold = db.data.players.find(p => p.line_uid === uid1);
    const p1NoGold = unpackTestPlayer(p1RowNoGold);
    p1NoGold.gold = 0;
    saveTestPlayer(p1RowNoGold, p1NoGold);

    const brokeBidRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 3, // Slot 3 đấu bằng G
        inc: 0,
        seen: stateData.slots[3].start
      })
    });
    const brokeBidData = await brokeBidRes.json();
    assert.strictEqual(brokeBidData.ok, false);
    assert.ok(brokeBidData.error.includes('không đủ vàng G'));

    // Xác nhận số dư không bị âm và slot không đổi
    db.load();
    const p1RowAfterBroke = db.data.players.find(p => p.line_uid === uid1);
    const p1AfterBroke = unpackTestPlayer(p1RowAfterBroke);
    assert.strictEqual(p1AfterBroke.gold, 0);
    console.log('  ✓ Hệ thống từ chối khi thiếu vàng G; số dư bảo toàn, không bị âm.');

    // Phục hồi lại vàng cho User 1
    p1AfterBroke.gold = 10000000;
    saveTestPlayer(p1RowAfterBroke, p1AfterBroke);

    // =========================================================================
    // PHẦN 8: CHỐNG CLIENT TAMPERING
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 8: CHỐNG CLIENT TAMPERING');
    console.log('========================================');

    const tamperRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 3,
        inc: 0,
        seen: stateData.slots[3].start,
        cost: 0,
        top: 1,
        amount: 99999999
      })
    });
    const tamperData = await tamperRes.json();
    assert.strictEqual(tamperData.ok, true);
    // Server tự trừ đúng startPrice của slot 3, bỏ qua cost: 0 hay amount giả mạo
    const expectedBal = 10000000 - stateData.slots[3].start;
    assert.strictEqual(tamperData.bal, expectedBal);
    console.log('  ✓ Client gửi cost:0, top:1 bị server bỏ qua hoàn toàn; server tự tính toán authoritative.');

    // Kiểm tra slot không hợp lệ (số âm, vượt quá 5, số thực)
    const badSlotRes1 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: -1, inc: 0 })
    }).then(r => r.json());
    assert.strictEqual(badSlotRes1.ok, false);

    const badSlotRes2 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 6, inc: 0 })
    }).then(r => r.json());
    assert.strictEqual(badSlotRes2.ok, false);

    const badSlotRes3 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 1.5, inc: 0 })
    }).then(r => r.json());
    assert.strictEqual(badSlotRes3.ok, false);
    console.log('  ✓ Chặn slot không hợp lệ (-1, 6, 1.5) an toàn.');

    // Kiểm tra chỉ số inc không hợp lệ (-1, 5)
    const badIncRes1 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 3, inc: -1 })
    }).then(r => r.json());
    assert.strictEqual(badIncRes1.ok, false);

    const badIncRes2 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 3, inc: 5 })
    }).then(r => r.json());
    assert.strictEqual(badIncRes2.ok, false);
    console.log('  ✓ Chặn chỉ số inc không hợp lệ (-1, 5) an toàn.');

    // Kiểm tra giá seen âm
    const badSeenRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 3, inc: 0, seen: -100 })
    }).then(r => r.json());
    assert.strictEqual(badSeenRes.ok, false);
    console.log('  ✓ Chặn giá seen âm an toàn.');

    // Kiểm tra Idempotency key chống duplicate charge khi client retry
    const curTopSlot3 = stateData.slots[3].start;
    const idemKey = `idem_test_${Date.now()}`;
    const idemRes1 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 3,
        inc: 0,
        seen: curTopSlot3,
        idempotency_key: idemKey
      })
    }).then(r => r.json());
    assert.strictEqual(idemRes1.ok, true);
    const balAfterIdem1 = idemRes1.bal;

    // Gửi lại cùng request và cùng idempotency_key
    const idemRes2 = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 3,
        inc: 0,
        seen: curTopSlot3,
        idempotency_key: idemKey
      })
    }).then(r => r.json());
    assert.strictEqual(idemRes2.ok, true);
    assert.strictEqual(idemRes2.bal, balAfterIdem1, 'Request retry cùng idempotency_key không được trừ tiền lần 2');
    console.log('  ✓ Idempotency key ngăn chặn double charge khi client retry mạng.');

    // =========================================================================
    // PHẦN 9: KIỂM THỬ ĐỒNG THỜI (CONCURRENT BIDS MUTEX)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 9: CONCURRENT BIDS QUA MUTEX');
    console.log('========================================');

    // Nạp đủ tiền cho cả 2 người ở slot 4 (đấu bằng G)
    db.load();
    const r1 = db.data.players.find(p => p.line_uid === uid1);
    const u1 = unpackTestPlayer(r1);
    u1.gold = 50000000;
    saveTestPlayer(r1, u1);

    const r2 = db.data.players.find(p => p.line_uid === uid2);
    const u2 = unpackTestPlayer(r2);
    u2.gold = 50000000;
    saveTestPlayer(r2, u2);

    // Mở bid đầu tiên cho slot 4
    await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: uid1,
        session_token: token1,
        action: 'bid',
        slot: 4,
        inc: 0,
        seen: stateData.slots[4].start
      })
    });

    // Lấy top hiện tại
    const curSlot4State = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'state' })
    }).then(r => r.json());
    const topSlot4 = curSlot4State.slots[4].top;

    // Bắn 2 bids đồng thời từ User 1 và User 2 với cùng seen
    // Một trong hai người sẽ tới trước và thành công, người thứ hai sẽ nhận moved: true
    const concurrentResponses = await Promise.all([
      fetch(`${baseUrl}/xhrpg_auction.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: uid2, session_token: token2, action: 'bid', slot: 4, inc: 0, seen: topSlot4 })
      }).then(r => r.json()),
      fetch(`${baseUrl}/xhrpg_auction.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'bid', slot: 4, inc: 0, seen: topSlot4 })
      }).then(r => r.json())
    ]);

    const successCount = concurrentResponses.filter(r => r.ok === true).length;
    const movedCount = concurrentResponses.filter(r => r.moved === true).length;
    assert.strictEqual(successCount, 1, 'Chính xác 1 request thành công');
    assert.strictEqual(movedCount, 1, 'Request chậm chân hơn bị chặn với moved: true');
    console.log('  ✓ Race condition được giải quyết an toàn qua Mutex: 1 thành công, 1 nhận moved: true.');

    // =========================================================================
    // PHẦN 10: ACTION 'HIST' (LỊCH SỬ ĐẶT GIÁ MINH BẠCH)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 10: KIỂM THỬ ACTION HIST');
    console.log('========================================');

    const histRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'hist', slot: 0 })
    });
    assert.strictEqual(histRes.status, 200);
    const histData = await histRes.json();
    assert.strictEqual(histData.ok, true);
    assert.ok(Array.isArray(histData.bids), 'Phải trả về mảng bids');
    assert.ok(histData.bids.length >= 3, 'Slot 0 phải có ít nhất 3 lượt đặt giá');

    // Kiểm tra cờ refunded: lượt đầu của User 1 phải có refunded = 1
    const firstBid = histData.bids[0];
    assert.strictEqual(firstBid.refunded, 1, 'Bid đầu tiên bị outbid phải có refunded = 1');
    console.log(`  ✓ Lịch sử bid minh bạch: Có ${histData.bids.length} lượt bid, cờ refunded chính xác.`);

    // =========================================================================
    // PHẦN 11: SETTLEMENT IDEMPOTENCY & TRAO THẺ VÀO TÚI
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 11: SETTLEMENT IDEMPOTENCY VÀ TRAO THẺ');
    console.log('========================================');

    // Người đang dẫn đầu slot 0 là User 2
    db.load();
    const p2RowBeforeSettle = db.data.players.find(p => p.line_uid === uid2);
    const p2BeforeSettle = unpackTestPlayer(p2RowBeforeSettle);
    let cardsBefore = p2BeforeSettle.cards;
    if (typeof cardsBefore === 'string') {
      try { cardsBefore = JSON.parse(cardsBefore || '{}'); } catch (e) { cardsBefore = {}; }
    }
    cardsBefore = cardsBefore || {};
    const cardIdSlot0 = String(stateData.slots[0].mid);
    const initialCardCount = (cardsBefore[cardIdSlot0] && cardsBefore[cardIdSlot0].n) || 0;

    // 11.1 Thử kích hoạt settlement khi không có quyền Admin (User thường không có key) -> Bị chặn 403
    const unauthSettleRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'settle' })
    });
    assert.strictEqual(unauthSettleRes.status, 403, 'Settle từ user thường không có admin key phải trả về HTTP 403 Forbidden');
    const unauthData = await unauthSettleRes.json();
    assert.strictEqual(unauthData.ok, false);
    console.log('  ✓ Endpoint settle được bảo vệ chặt chẽ: User thường bị chặn với HTTP 403 Forbidden.');

    // 11.2 Kích hoạt settlement lần 1 với Admin API Key
    const settle1Res = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-api-key': 'test_admin_secret_key'
      },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'settle' })
    });
    assert.strictEqual(settle1Res.status, 200);
    const settle1Data = await settle1Res.json();
    assert.strictEqual(settle1Data.ok, true);
    assert.strictEqual(settle1Data.settled, true);

    // Kiểm tra User 2 đã nhận được thẻ bài trong cards
    db.load();
    const p2RowAfterSettle1 = db.data.players.find(p => p.line_uid === uid2);
    const p2AfterSettle1 = unpackTestPlayer(p2RowAfterSettle1);
    let cardsAfter1 = p2AfterSettle1.cards;
    if (typeof cardsAfter1 === 'string') {
      try { cardsAfter1 = JSON.parse(cardsAfter1 || '{}'); } catch (e) { cardsAfter1 = {}; }
    }
    const cardCountAfter1 = (cardsAfter1[cardIdSlot0] && cardsAfter1[cardIdSlot0].n) || 0;
    assert.strictEqual(cardCountAfter1, initialCardCount + 1, 'Thẻ bài phải được trao cho người thắng cuộc');
    console.log(`  ✓ Kết toán lần 1 thành công: Người thắng (User 2) nhận thẻ mid=${cardIdSlot0} (+1).`);

    // 11.3 Kích hoạt settlement lần 2 (Idempotency check) với Admin API Key
    const settle2Res = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-api-key': 'test_admin_secret_key'
      },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'settle' })
    });
    assert.strictEqual(settle2Res.status, 200);
    const settle2Data = await settle2Res.json();
    assert.strictEqual(settle2Data.ok, true);

    // Kiểm tra số lượng thẻ bài không bị cộng lần thứ 2
    db.load();
    const p2RowAfterSettle2 = db.data.players.find(p => p.line_uid === uid2);
    const p2AfterSettle2 = unpackTestPlayer(p2RowAfterSettle2);
    let cardsAfter2 = p2AfterSettle2.cards;
    if (typeof cardsAfter2 === 'string') {
      try { cardsAfter2 = JSON.parse(cardsAfter2 || '{}'); } catch (e) { cardsAfter2 = {}; }
    }
    const cardCountAfter2 = (cardsAfter2[cardIdSlot0] && cardsAfter2[cardIdSlot0].n) || 0;
    assert.strictEqual(cardCountAfter2, cardCountAfter1, 'Kết toán lần 2 không được duplicate trao thẻ (Idempotent)');
    console.log('  ✓ Kết toán lần 2 không làm tăng thẻ: Bảo đảm tính Idempotent 100%.');

    // =========================================================================
    // PHẦN 12: ACTION 'PREV' (KẾT QUẢ CÁC VÒNG TRƯỚC)
    // =========================================================================
    console.log('\n========================================');
    console.log('PHẦN 12: KIỂM THỬ ACTION PREV');
    console.log('========================================');

    const prevRes = await fetch(`${baseUrl}/xhrpg_auction.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: uid1, session_token: token1, action: 'prev' })
    });
    assert.strictEqual(prevRes.status, 200);
    const prevData = await prevRes.json();
    assert.strictEqual(prevData.ok, true);
    assert.ok(Array.isArray(prevData.rounds), 'Phải trả về mảng rounds');
    assert.ok(prevData.rounds.length > 0, 'Phải có bản ghi kết quả vừa kết toán');
    console.log(`  ✓ Prev endpoint trả về kết quả các vòng trước: ${prevData.rounds.length} bản ghi.`);

    console.log('\n🎉 TOÀN BỘ KIỂM THỬ HỆ THỐNG ĐẤU GIÁ ĐÃ PASS 100%!');
  } finally {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(r => setTimeout(r, 50));
      await new Promise(r => server.close(r));
    }
    // Dọn dẹp test users và test auction records
    db.load();
    if (uid1 || uid2) {
      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => u.line_uid !== uid1 && u.line_uid !== uid2);
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => p.line_uid !== uid1 && p.line_uid !== uid2);
      }
    }
    // Dọn dẹp auction test data
    delete db.data.auction_rounds;
    delete db.data.auction_bids;
    delete db.data.auction_history;
    db.save();
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!\n');
  }
}

runAuctionTests().catch(err => {
  console.error('❌ LỖI AUCTION TEST:', err);
  process.exit(1);
});
