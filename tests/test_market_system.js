const assert = require('assert');
const db = require('../server/db/queries');
const marketRoute = require('../server/routes/market');

console.log('🧪 Bắt đầu kiểm thử toàn diện hệ thống Chợ (Market System - TASK-021)...');

function cleanupTestRecords(uids = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_seller_') || uid.startsWith('test_buyer_');
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
      db.save();
    }
  } catch (err) {
    console.error('Lỗi khi cleanup database:', err);
  }
}

function callMarket(body) {
  if (body && body.line_uid && !body.session_token) {
    db.load();
    const u = db.data && db.data.users && db.data.users.find(x => x.line_uid === body.line_uid);
    if (u && u.session_token) body.session_token = u.session_token;
  }
  return new Promise((resolve) => {
    marketRoute.handle(
      { method: 'POST', url: '/', body },
      {
        json: (res) => resolve(res)
      },
      () => {}
    );
  });
}

async function runTests() {
  // Tạo UIDs ngẫu nhiên duy nhất cho mỗi lượt chạy test
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const sellerUid = 'test_seller_' + uniqueSuffix;
  const buyerUid = 'test_buyer_' + uniqueSuffix;
  const testUids = [sellerUid, buyerUid];

  // Dọn dẹp trước phòng trường hợp còn sót dữ liệu
  cleanupTestRecords(testUids);

  try {
    const initialSellerObj = {
      line_uid: sellerUid,
      name: 'Seller Alice',
      lv: 50,
      gold: 5000,
      cards: JSON.stringify({
        '10': { n: 5, m: 2 }, // 5 thẻ thường, 2 thẻ MVP #10
        '20': { n: 1, m: 0 }
      }),
      eggs: JSON.stringify({
        '15': { n: 3, m: 1 }  // 3 trứng thường, 1 trứng MVP #15
      }),
      module_inventory: JSON.stringify([
        { slot: 'barrel', rarity: 3, plus: 2, stat: 'atk', cards: [] },
        { slot: 'mag', rarity: 2, plus: 0, stat: null, cards: [] }
      ]),
      module_box1: 10,
      card_box2: 5,
      wood: 100,
      diamond_blue: 20,
      ore1: 15,
      ammo_pistol: 500
    };

    const initialBuyerObj = {
      line_uid: buyerUid,
      name: 'Buyer Bob',
      lv: 30,
      gold: 50000,
      cards: JSON.stringify({}),
      eggs: JSON.stringify({}),
      module_inventory: JSON.stringify([]),
      module_box1: 0,
      card_box2: 0,
      wood: 0,
      diamond_blue: 0,
      ore1: 0,
      ammo_pistol: 100
    };

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      sellerUid, 'seller_alice_' + uniqueSuffix, 'hash', 'mock_token_s_' + uniqueSuffix
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      sellerUid, initialSellerObj.name, JSON.stringify(initialSellerObj)
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      buyerUid, 'buyer_bob_' + uniqueSuffix, 'hash', 'mock_token_b_' + uniqueSuffix
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      buyerUid, initialBuyerObj.name, JSON.stringify(initialBuyerObj)
    );

    // --- TEST 1: get_listings trả đúng danh sách và format ---
    console.log('\n▶ Test 1: Kiểm tra get_listings cơ bản...');
    const resListings = await callMarket({ line_uid: buyerUid, action: 'get_listings' });
    assert.strictEqual(resListings.ok, true, 'get_listings phải trả về ok: true');
    assert.ok(Array.isArray(resListings.listings), 'listings phải là mảng');
    assert.ok(resListings.listings.length > 0, 'Phải có ít nhất các item mặc định (seed)');
    const firstItem = resListings.listings[0];
    assert.ok(firstItem.id !== undefined, 'Item phải có id');
    assert.ok(firstItem.item_name !== undefined, 'Item phải có item_name');
    assert.ok(firstItem.price_per !== undefined, 'Item phải có price_per');
    assert.ok(firstItem.expires_at !== undefined, 'Item phải có expires_at');
    assert.ok(firstItem.seller_name !== undefined, 'Item phải có seller_name');
    console.log('  ✓ get_listings trả về danh sách hợp lệ, số lượng listing:', resListings.listings.length);

    // --- TEST 2: Đăng bán (sell) các loại item ---
    console.log('\n▶ Test 2: Kiểm tra chức năng Đăng bán (sell) và Escrow vật phẩm...');
    
    // 2.1 Bán Thẻ bài MVP #10 (số lượng 1, giá 3000)
    const resSellMvpCard = await callMarket({
      line_uid: sellerUid,
      action: 'sell',
      item_type: 'card',
      item_id: 10,
      item_slot: 'mvp',
      qty: 1,
      price_per: 3000
    });
    assert.strictEqual(resSellMvpCard.ok, true, 'Bán thẻ MVP phải thành công');
    const s1Cards = JSON.parse(resSellMvpCard.player.cards);
    assert.strictEqual(s1Cards['10'].m, 1, 'Thẻ MVP #10 của người bán phải giảm từ 2 xuống 1');
    console.log('  ✓ Đăng bán Thẻ MVP thành công, trừ đúng thẻ MVP.');

  // 2.2 Bán Thẻ bài Thường #20 (số lượng 1, giá 500)
  const resSellNormCard = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'card',
    item_id: 20,
    item_slot: 'normal',
    qty: 1,
    price_per: 500
  });
  assert.strictEqual(resSellNormCard.ok, true, 'Bán thẻ thường #20 phại thành công');
  const s2Cards = JSON.parse(resSellNormCard.player.cards);
  assert.strictEqual(s2Cards['20'].n, 0, 'Thẻ thường #20 của người bán phại giảm về 0');

  // 2.3 Bán Trứng thú
  const resSellEgg = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'egg',
    item_id: 15,
    item_slot: 'normal',
    qty: 2,
    price_per: 800
  });
  assert.strictEqual(resSellEgg.ok, true, 'Bán 2 trứng thú phải thành công');
  const sEggs = JSON.parse(resSellEgg.player.eggs);
  assert.strictEqual(sEggs['15'].n, 1, 'Trứng thường #15 giảm từ 3 xuống 1');
  assert.strictEqual(sEggs['15'].m, 1, 'Trứng MVP #15 giữ nguyên 1');

  // 2.4 Bán Module súng T3
  const resSellMod = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'module_pistol',
    item_id: 0,
    item_slot: 'barrel',
    qty: 1,
    price_per: 2500
  });
  assert.strictEqual(resSellMod.ok, true, 'Bán Module súng phải thành công');
  const sMods = JSON.parse(resSellMod.player.module_inventory);
  assert.strictEqual(sMods.length, 1, 'Hòm đồ module giảm từ 2 xuống 1');

  // 2.5 Bán Module Box T1
  const resSellBox = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'module_box',
    item_id: 1,
    item_tier: 1,
    qty: 4,
    price_per: 400
  });
  assert.strictEqual(resSellBox.ok, true, 'Bán 4 hộp module T1 phải thành công');
  assert.strictEqual(resSellBox.player.module_box1, 6, 'Module box 1 giảm từ 10 xuống 6');

  // 2.6 Bán Tài nguyên Gỗ (wood)
  const resSellWood = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'resource',
    item_id: 'wood',
    item_slot: 'wood',
    qty: 30,
    price_per: 10
  });
  assert.strictEqual(resSellWood.ok, true, 'Bán 30 gỗ phải thành công');
  assert.strictEqual(resSellWood.player.wood, 70, 'Gỗ giảm từ 100 xuống 70');

  // 2.7 Bán quá số lượng hiện có -> phải thất bại
  const resSellFail = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'resource',
    item_id: 'wood',
    item_slot: 'wood',
    qty: 1000,
    price_per: 10
  });
  assert.strictEqual(resSellFail.ok, false, 'Bán vượt quá số lượng phải thất bại');
  console.log('  ✓ Đăng bán các loại vật phẩm thành công, kiểm tra escrow chính xác.');

  // --- TEST 3: get_my_listings chỉ trả listing của người gọi ---
  console.log('\n▶ Test 3: Kiểm tra get_my_listings cách ly giữa các người chơi...');
  const sellerListingsRes = await callMarket({ line_uid: sellerUid, action: 'get_my_listings' });
  assert.strictEqual(sellerListingsRes.ok, true);
  assert.strictEqual(sellerListingsRes.listings.length, 6, 'Seller Alice phải có đúng 6 listing đang bán');
  sellerListingsRes.listings.forEach(l => {
    assert.strictEqual(l.seller_uid, sellerUid, 'Tất cả listing trả về phải thuộc sellerUid');
    assert.ok(parseInt(l.expires_at) > Math.floor(Date.now() / 1000), 'expires_at phải ở tương lai');
    assert.strictEqual(l.seller_name, 'Seller Alice', 'seller_name phải hiển thị đúng');
  });

  const buyerListingsRes = await callMarket({ line_uid: buyerUid, action: 'get_my_listings' });
  assert.strictEqual(buyerListingsRes.ok, true);
  assert.strictEqual(buyerListingsRes.listings.length, 0, 'Buyer Bob chưa bán gì nên listings phải rỗng');
  console.log('  ✓ get_my_listings lọc chính xác theo line_uid, đủ các trường UI cần.');

  // --- TEST 4: Hủy đăng bán (cancel) và hoàn trả vật phẩm ---
  console.log('\n▶ Test 4: Kiểm tra chức năng Hủy bán (cancel) & Hoàn trả escrow...');
  const woodListing = sellerListingsRes.listings.find(l => l.item_type === 'resource' && l.item_id === 'wood');
  const modListing = sellerListingsRes.listings.find(l => l.item_type === 'module_pistol');
  assert.ok(woodListing, 'Phải tìm thấy listing gỗ');
  assert.ok(modListing, 'Phải tìm thấy listing module');

  // 4.1 Người khác (Buyer Bob) cố tình hủy listing của Alice -> Thất bại
  const resCancelUnauthorized = await callMarket({
    line_uid: buyerUid,
    action: 'cancel',
    listing_id: woodListing.id
  });
  assert.strictEqual(resCancelUnauthorized.ok, false, 'Không được phép hủy listing của người khác');
  console.log('  ✓ Chặn hủy listing của người khác thành công:', resCancelUnauthorized.error);

  // 4.2 Chính chủ (Alice) hủy listing Gỗ (30 gỗ) -> Thành công, hoàn trả 30 gỗ
  const resCancelWood = await callMarket({
    line_uid: sellerUid,
    action: 'cancel',
    listing_id: woodListing.id
  });
  assert.strictEqual(resCancelWood.ok, true, 'Hủy listing gỗ phải thành công');
  assert.strictEqual(resCancelWood.player.wood, 100, 'Gỗ của Alice được hoàn trả đủ 100 (70 + 30)');
  console.log('  ✓ Hủy listing gỗ thành công, hoàn trả đủ 30 gỗ về túi.');

  // 4.3 Chính chủ (Alice) hủy listing Module -> Thành công, hoàn trả module về hòm đồ
  const resCancelMod = await callMarket({
    line_uid: sellerUid,
    action: 'cancel',
    listing_id: modListing.id
  });
  assert.strictEqual(resCancelMod.ok, true, 'Hủy listing module phải thành công');
  const restoredMods = JSON.parse(resCancelMod.player.module_inventory);
  assert.strictEqual(restoredMods.length, 2, 'Module được hoàn trả lại hòm đồ (tăng từ 1 lên 2)');
  console.log('  ✓ Hủy listing module thành công, hoàn trả đúng module về hòm đồ.');

  // Kiểm tra listing đã bị xóa khỏi chợ (sau khi hủy 2, Alice còn 4)
  const afterCancelListings = await callMarket({ line_uid: sellerUid, action: 'get_my_listings' });
  assert.strictEqual(afterCancelListings.listings.length, 4, 'Sau khi hủy 2, Alice còn 4 listing');

  // --- TEST 5: Mua hàng (buy) ---
  console.log('\n▶ Test 5: Kiểm tra chức năng Mua hàng (buy)...');
  const mvpCardListing = afterCancelListings.listings.find(l => l.item_type === 'card' && l.item_slot === 'mvp');
  const boxListing = afterCancelListings.listings.find(l => l.item_type === 'module_box');
  assert.ok(mvpCardListing, 'Phải có listing thẻ MVP');
  assert.ok(boxListing, 'Phải có listing hộp quà');

  // 5.1 Alice cố tình mua listing của chính mình
  const resBuyOwn = await callMarket({
    line_uid: sellerUid,
    action: 'buy',
    listing_id: mvpCardListing.id,
    qty: 1
  });
  assert.strictEqual(resBuyOwn.ok, false, 'Không được phép mua listing của chính mình');
  console.log('  ✓ Chặn mua listing của chính mình thành công:', resBuyOwn.error);

  // 5.2 Bob mua 2 hộp quà T1 từ Alice (giá 400 * 2 = 800 vàng)
  const initialBobGold = 50000;
  const initialAliceGold = 5000;
  const resBuyBox = await callMarket({
    line_uid: buyerUid,
    action: 'buy',
    listing_id: boxListing.id,
    qty: 2
  });
  assert.strictEqual(resBuyBox.ok, true, 'Bob mua 2 hộp quà phải thành công');
  assert.strictEqual(resBuyBox.player.gold, initialBobGold - 800, 'Vàng của Bob bị trừ đúng 800');
  assert.strictEqual(resBuyBox.player.module_box1, 2, 'Bob nhận được đúng 2 hộp quà T1');

  // Kiểm tra vàng của Alice được cộng 800
  const aliceRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid);
  const aliceObj = JSON.parse(aliceRow.raw_data);
  assert.strictEqual(aliceObj.gold, initialAliceGold + 800, 'Vàng của Alice được cộng đúng 800');

  // Kiểm tra số lượng listing còn lại trên chợ (4 - 2 = 2)
  const allListingsAfterBuy = await callMarket({ line_uid: buyerUid, action: 'get_listings' });
  const updatedBoxListing = allListingsAfterBuy.listings.find(l => l.id === boxListing.id);
  assert.ok(updatedBoxListing, 'Listing hộp quà vẫn còn vì chưa bán hết');
  assert.strictEqual(updatedBoxListing.qty, 2, 'Số lượng hộp còn lại phải là 2');
  console.log('  ✓ Mua một phần thành công: trừ tiền người mua, cộng tiền người bán, giảm đúng qty listing.');

  // 5.3 Bob mua toàn bộ Thẻ MVP #10 (giá 3000)
  const resBuyMvp = await callMarket({
    line_uid: buyerUid,
    action: 'buy',
    listing_id: mvpCardListing.id,
    qty: 1
  });
  assert.strictEqual(resBuyMvp.ok, true, 'Bob mua thẻ MVP phải thành công');
  const bobCards = JSON.parse(resBuyMvp.player.cards);
  assert.strictEqual(bobCards['10'].m, 1, 'Bob nhận được 1 thẻ MVP #10');

  // Listing thẻ MVP phải bị xóa khỏi chợ vì qty về 0
  const afterMvpBuyListings = await callMarket({ line_uid: buyerUid, action: 'get_listings' });
  assert.strictEqual(afterMvpBuyListings.listings.some(l => l.id === mvpCardListing.id), false, 'Listing thẻ MVP đã bán hết phải bị xóa');
  console.log('  ✓ Mua toàn bộ thành công: nhận vật phẩm, listing bị xóa khỏi chợ.');

  // --- TEST 6: Lịch sử giao dịch (get_history) ---
  console.log('\n▶ Test 6: Kiểm tra Lịch sử giao dịch (get_history) và bộ lọc...');

  // 6.1 Lịch sử của Alice: 2 lần hủy (cancelled), 2 lần bán (sold)
  const aliceHistAll = await callMarket({ line_uid: sellerUid, action: 'get_history', filter: 'all' });
  assert.strictEqual(aliceHistAll.ok, true);
  assert.strictEqual(aliceHistAll.rows.length, 4, 'Alice có tổng cộng 4 bản ghi lịch sử');
  assert.strictEqual(aliceHistAll.summary.sold_count, 2, 'Số lượng bán = 2');
  assert.strictEqual(aliceHistAll.summary.bought_count, 0, 'Số lượng mua = 0');
  assert.strictEqual(aliceHistAll.summary.income, 3800, 'Thu nhập của Alice = 800 + 3000 = 3800 G');
  console.log('  ✓ get_history Alice filter=all tính đúng summary: sold=2, income=+3800 G');

  // 6.2 Filter 'sold' của Alice
  const aliceHistSold = await callMarket({ line_uid: sellerUid, action: 'get_history', filter: 'sold' });
  assert.strictEqual(aliceHistSold.rows.length, 2, 'Alice có đúng 2 bản ghi bán');
  aliceHistSold.rows.forEach(r => {
    assert.strictEqual(r.status, 'sold');
    assert.ok(r.gold_change > 0, 'gold_change khi bán phải dương');
    assert.strictEqual(r.counterpart_name, 'Buyer Bob', 'Người mua đối ứng phải là Buyer Bob');
  });

  // 6.3 Filter 'cancelled' của Alice
  const aliceHistCancel = await callMarket({ line_uid: sellerUid, action: 'get_history', filter: 'cancelled' });
  assert.strictEqual(aliceHistCancel.rows.length, 2, 'Alice có đúng 2 bản ghi hủy');
  aliceHistCancel.rows.forEach(r => {
    assert.strictEqual(r.status, 'cancelled');
    assert.strictEqual(r.gold_change, 0, 'gold_change khi hủy phải bằng 0');
  });

  // 6.4 Lịch sử của Bob: 2 lần mua (bought)
  const bobHistAll = await callMarket({ line_uid: buyerUid, action: 'get_history', filter: 'all' });
  assert.strictEqual(bobHistAll.ok, true);
  assert.strictEqual(bobHistAll.rows.length, 2, 'Bob có đúng 2 bản ghi mua');
  assert.strictEqual(bobHistAll.summary.bought_count, 2, 'Số lượng mua = 2');
  assert.strictEqual(bobHistAll.summary.sold_count, 0, 'Số lượng bán = 0');
  assert.strictEqual(bobHistAll.summary.income, -3800, 'Chi tiêu của Bob = -3800 G');
  bobHistAll.rows.forEach(r => {
    assert.strictEqual(r.status, 'bought');
    assert.ok(r.gold_change < 0, 'gold_change khi mua phải âm');
    assert.strictEqual(r.counterpart_name, 'Seller Alice', 'Người bán đối ứng phải là Seller Alice');
  });
  console.log('  ✓ get_history Bob filter=all tính đúng summary: bought=2, income=-3800 G');

  // --- TEST 7: Kiểm tra Rollback giao dịch nguyên tử khi gặp lỗi I/O (Atomic Rollback) ---
  console.log('\n▶ Test 7: Kiểm tra Rollback nguyên tử khi giả lập lỗi (Crash / I/O Failure)...');

  const originalSave = db.save.bind(db);

  // 7.1 Lỗi khi sell -> Không trừ item, không tạo listing rác
  const aliceBeforeSellFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  const listingsBeforeSellFail = (db.data.market_listings || []).length;
  
  db.save = () => { throw new Error('Simulated disk I/O error during sell'); };
  const resFailSell = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'resource',
    item_id: 'wood',
    item_slot: 'wood',
    qty: 50,
    price_per: 10
  });
  db.save = originalSave;

  assert.strictEqual(resFailSell.ok, false, 'Giao dịch sell khi gặp lỗi I/O phải trả về ok: false');
  db.load();
  const aliceAfterSellFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  assert.strictEqual(aliceAfterSellFail.wood, aliceBeforeSellFail.wood, 'Gỗ của Alice phải được rollback nguyên vẹn (100 gỗ)');
  assert.strictEqual((db.data.market_listings || []).length, listingsBeforeSellFail, 'Không được tạo listing rác khi sell bị lỗi');
  console.log('  ✓ Rollback khi Sell lỗi thành công: không trừ vật phẩm, không tạo listing rác.');

  // 7.2 Đăng bán 20 gỗ chuẩn để chuẩn bị test cancel & buy fail
  const resSellForRollback = await callMarket({
    line_uid: sellerUid,
    action: 'sell',
    item_type: 'resource',
    item_id: 'wood',
    item_slot: 'wood',
    qty: 20,
    price_per: 15
  });
  assert.strictEqual(resSellForRollback.ok, true);
  db.load();
  const rollbackListing = (db.data.market_listings || []).find(l => l.seller_uid === sellerUid && l.item_id === 'wood' && l.price_per === 15);
  assert.ok(rollbackListing, 'Phải tạo thành công listing 20 gỗ');

  // 7.3 Lỗi khi cancel -> Không hoàn trả trùng lặp, giữ nguyên listing
  const aliceBeforeCancelFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  db.save = () => { throw new Error('Simulated disk I/O error during cancel'); };
  const resFailCancel = await callMarket({
    line_uid: sellerUid,
    action: 'cancel',
    listing_id: rollbackListing.id
  });
  db.save = originalSave;

  assert.strictEqual(resFailCancel.ok, false, 'Giao dịch cancel khi gặp lỗi I/O phải trả về ok: false');
  db.load();
  const aliceAfterCancelFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  assert.strictEqual(aliceAfterCancelFail.wood, aliceBeforeCancelFail.wood, 'Gỗ của Alice không bị hoàn trả kép khi cancel lỗi');
  const listingStillExists = (db.data.market_listings || []).some(l => l.id === rollbackListing.id);
  assert.strictEqual(listingStillExists, true, 'Listing vẫn phải tồn tại trên chợ sau khi cancel thất bại');
  console.log('  ✓ Rollback khi Cancel lỗi thành công: không nhân đôi vật phẩm, giữ nguyên listing trên chợ.');

  // 7.4 Lỗi khi buy -> Không trừ tiền buyer, không cộng tiền seller, không chuyển giao item, không giảm qty listing
  const bobBeforeBuyFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(buyerUid).raw_data);
  const aliceBeforeBuyFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  const histCountBeforeBuyFail = (db.data.market_history || []).length;

  db.save = () => { throw new Error('Simulated disk I/O error during buy'); };
  const resFailBuy = await callMarket({
    line_uid: buyerUid,
    action: 'buy',
    listing_id: rollbackListing.id,
    qty: 10
  });
  db.save = originalSave;

  assert.strictEqual(resFailBuy.ok, false, 'Giao dịch buy khi gặp lỗi I/O phải trả về ok: false');
  db.load();
  const bobAfterBuyFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(buyerUid).raw_data);
  const aliceAfterBuyFail = JSON.parse(db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(sellerUid).raw_data);
  const listingAfterBuyFail = (db.data.market_listings || []).find(l => l.id === rollbackListing.id);
  const histCountAfterBuyFail = (db.data.market_history || []).length;

  assert.strictEqual(bobAfterBuyFail.gold, bobBeforeBuyFail.gold, 'Vàng của người mua không bị trừ');
  assert.strictEqual(bobAfterBuyFail.wood || 0, bobBeforeBuyFail.wood || 0, 'Người mua không nhận thêm gỗ');
  assert.strictEqual(aliceAfterBuyFail.gold, aliceBeforeBuyFail.gold, 'Vàng của người bán không bị thay đổi');
  assert.strictEqual(listingAfterBuyFail.qty, 20, 'Số lượng listing trên chợ được giữ nguyên 20');
  assert.strictEqual(histCountAfterBuyFail, histCountBeforeBuyFail, 'Không thêm lịch sử sold khi buy gặp lỗi');
  console.log('  ✓ Rollback khi Buy lỗi thành công: không lệch vàng/item người mua và người bán, bảo toàn listing.');

  console.log('\n🎉 TẤT CẢ 7 BỘ KIỂM THỬ THỊ TRƯỜNG & ATOMIC ROLLBACK ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    // Luôn dọn dẹp sạch sẽ các bản ghi test dù assertion pass hay fail
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