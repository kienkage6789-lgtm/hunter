const express = require('express');
const db = require('../db/queries');

const router = express.Router();

const MOD_INV_FIELDS = {
  pistol: 'module_inventory', sniper: 'sniper_module_inventory', knife: 'knife_module_inventory',
  axe: 'axe_module_inventory', robot: 'robot_module_inventory', robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory', armor: 'armor_module_inventory', house: 'house_module_inventory',
  turret: 'turret_module_inventory'
};

const COLLECTIBLE_FIELDS = {
  treasure: 'treasures', hardware: 'hardware', weapon_parts: 'weapon_parts',
  house_parts: 'house_parts', stat_parts: 'stat_parts'
};

// Chuẩn hóa một listing đảm bảo đủ trường client UI sử dụng
function formatListing(l) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: l.id,
    item_name: l.item_name || 'Vật phẩm',
    item_type: l.item_type || 'misc',
    item_id: l.item_id !== undefined ? l.item_id : 0,
    item_slot: l.item_slot || 'normal',
    item_tier: parseInt(l.item_tier) || 0,
    item_icon: l.item_icon || (l.item_type === 'egg' ? '🥚' : (l.item_type === 'card' ? '🎴' : (l.item_type && l.item_type.startsWith('module_') ? '🔧' : '📦'))),
    item_desc: l.item_desc || '',
    item_rarity: l.item_rarity || 'white',
    item_payload: l.item_payload || null,
    price_per: parseInt(l.price_per) || 0,
    qty: parseInt(l.qty) || 0,
    seller_uid: l.seller_uid || 'npc',
    seller_name: l.seller_name || (l.seller_uid === 'npc' ? 'NPC Chợ' : 'Người chơi'),
    expires_at: parseInt(l.expires_at) || (now + (l.seller_uid === 'npc' ? 86400 * 365 : 86400 * 7)),
    created_at: parseInt(l.created_at) || now
  };
}

// Seed dữ liệu chợ mặc định nếu trống
function seedMarketListings() {
  if (!db.data.market_listings) {
    db.data.market_listings = [];
  }
  if (!db.data.market_history) {
    db.data.market_history = [];
  }
  if (db.data.market_listings.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    const farFuture = now + 86400 * 365;
    db.data.market_listings.push(
      { id: 101, item_name: "Thẻ Gà con (1⭐)", item_type: "card", item_id: 1, item_slot: "normal", item_tier: 0, item_icon: "🎴", item_desc: "Thẻ bài quái vật", item_rarity: "white", item_payload: null, price_per: 500, qty: 1, seller_uid: "npc", seller_name: "NPC Chợ", expires_at: farFuture, created_at: now },
      { id: 102, item_name: "Thẻ Heo con (1⭐)", item_type: "card", item_id: 2, item_slot: "normal", item_tier: 0, item_icon: "🎴", item_desc: "Thẻ bài quái vật", item_rarity: "white", item_payload: null, price_per: 800, qty: 1, seller_uid: "npc", seller_name: "NPC Chợ", expires_at: farFuture, created_at: now },
      { id: 103, item_name: "Trứng Slime xanh (1⭐)", item_type: "egg", item_id: 19, item_slot: "normal", item_tier: 0, item_icon: "🥚", item_desc: "Trứng Slime xanh", item_rarity: "white", item_payload: null, price_per: 1200, qty: 1, seller_uid: "npc", seller_name: "NPC Chợ", expires_at: farFuture, created_at: now },
      { id: 104, item_name: "Module Súng T1", item_type: "module", item_id: 1, item_slot: "normal", item_tier: 1, item_icon: "📦", item_desc: "Hộp Module T1", item_rarity: "blue", item_payload: null, price_per: 1500, qty: 1, seller_uid: "npc", seller_name: "NPC Chợ", expires_at: farFuture, created_at: now },
      { id: 105, item_name: "Module Dao T3", item_type: "module", item_id: 3, item_slot: "normal", item_tier: 3, item_icon: "📦", item_desc: "Hộp Module T3", item_rarity: "gold", item_payload: null, price_per: 2500, qty: 1, seller_uid: "npc", seller_name: "NPC Chợ", expires_at: farFuture, created_at: now }
    );
    db.save();
  }
}

// Trừ vật phẩm từ túi đồ người chơi (escrow khi đăng bán)
function deductItemFromPlayer(playerObj, itemData) {
  const item_type = itemData.item_type;
  const item_id = itemData.item_id;
  const item_slot = itemData.item_slot;
  const item_tier = itemData.item_tier;
  const item_name = itemData.item_name;
  const qty = itemData.qty;

  // 1. Thẻ bài (card)
  if (item_type === 'card') {
    let cards = playerObj.cards;
    if (typeof cards === 'string') { try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; } }
    cards = cards || {};
    const cardId = parseInt(item_id);
    const cardObj = cards[cardId] || { n: 0, m: 0 };
    const isMvp = item_slot === 'mvp';
    const available = isMvp ? (cardObj.m || 0) : (cardObj.n || 0);
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ thẻ bài để bán!" };
    }
    if (isMvp) cardObj.m -= qty;
    else cardObj.n -= qty;
    cards[cardId] = cardObj;
    playerObj.cards = JSON.stringify(cards);
    return { ok: true, name: item_name || `Thẻ bài #${cardId}${isMvp ? ' ⭐MVP' : ''}` };
  }

  // 2. Trứng thú cưng (egg)
  if (item_type === 'egg') {
    let eggs = playerObj.eggs;
    if (typeof eggs === 'string') { try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; } }
    eggs = eggs || {};
    const eggId = parseInt(item_id);
    const eggObj = eggs[eggId] || { n: 0, m: 0 };
    const isMvp = item_slot === 'mvp';
    const available = isMvp ? (eggObj.m || 0) : (eggObj.n || 0);
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ trứng thú cưng để bán!" };
    }
    if (isMvp) eggObj.m -= qty;
    else eggObj.n -= qty;
    eggs[eggId] = eggObj;
    playerObj.eggs = JSON.stringify(eggs);
    return { ok: true, name: item_name || `Trứng thú #${eggId}${isMvp ? ' ⭐MVP' : ''}` };
  }

  // 3. Module vũ khí (module_*)
  if (item_type && item_type.startsWith('module_') && item_type !== 'module_box') {
    const weapon = item_type.replace('module_', '');
    const invField = MOD_INV_FIELDS[weapon];
    if (!invField) {
      return { ok: false, error: "Loại module không hợp lệ!" };
    }
    let inv = playerObj[invField];
    if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
    inv = inv || [];

    const idx = parseInt(item_id);
    let targetMod = null;
    if (idx >= 0 && idx < inv.length) {
      const m = inv[idx];
      if (!item_slot || m.slot === item_slot) {
        targetMod = inv.splice(idx, 1)[0];
      }
    }
    if (!targetMod) {
      // Tìm module phù hợp theo slot và payload nếu có
      const findIdx = inv.findIndex(m => m && (!item_slot || m.slot === item_slot));
      if (findIdx !== -1) {
        targetMod = inv.splice(findIdx, 1)[0];
      }
    }

    if (!targetMod) {
      return { ok: false, error: "Không tìm thấy module phù hợp trong hòm đồ để bán!" };
    }

    playerObj[invField] = JSON.stringify(inv);
    const payloadStr = itemData.item_payload || JSON.stringify(targetMod);
    return {
      ok: true,
      name: item_name || `Module T${targetMod.t || targetMod.rarity || 1} (${targetMod.slot})`,
      payload: payloadStr
    };
  }

  // 4. Hộp quà ngẫu nhiên (module_box, card_box, egg_box, module)
  if (item_type === 'module' || item_type === 'module_box' || item_type === 'card_box' || item_type === 'egg_box') {
    const actualType = (item_type === 'module') ? 'module_box' : item_type;
    const tier = parseInt(item_tier) || parseInt(item_id) || 1;
    const boxField = `${actualType}${tier}`;
    const available = parseInt(playerObj[boxField]) || 0;
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ hộp quà trong túi đồ để bán!" };
    }
    playerObj[boxField] = available - qty;
    const boxLabel = actualType === 'module_box' ? 'Module' : (actualType === 'card_box' ? 'Thẻ bài' : 'Trứng');
    return { ok: true, name: item_name || `Hộp ${boxLabel} T${tier}` };
  }

  // 5. Tài nguyên, Kim cương, Quặng không gian (resource, diamond, ore)
  if (item_type === 'resource' || item_type === 'diamond' || item_type === 'ore') {
    const field = item_slot || item_id;
    const available = parseInt(playerObj[field]) || 0;
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ tài nguyên trong túi đồ để bán!" };
    }
    playerObj[field] = available - qty;
    return { ok: true, name: item_name || field };
  }

  // 6. Đạn (ammo)
  if (item_type === 'ammo') {
    const gun = item_slot || 'pistol';
    const tier = parseInt(item_tier) || 1;
    if (tier <= 1) {
      const k = 'ammo_' + (gun === 'robot' ? 'robot_gun' : gun);
      const available = parseInt(playerObj[k]) || 0;
      if (available < qty) {
        return { ok: false, error: "Bạn không có đủ đạn để bán!" };
      }
      playerObj[k] = available - qty;
    } else {
      const f = 'ammo_' + (gun === 'robot' ? 'robot' : gun) + '_extra';
      let extra = playerObj[f];
      if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch(e) { extra = []; } }
      extra = Array.isArray(extra) ? extra : [];
      const idx = tier - 2;
      const available = parseInt(extra[idx]) || 0;
      if (available < qty) {
        return { ok: false, error: "Bạn không có đủ đạn cấp cao để bán!" };
      }
      extra[idx] = available - qty;
      playerObj[f] = JSON.stringify(extra);
    }
    return { ok: true, name: item_name || `Đạn ${gun} T${tier}` };
  }

  // 7. Trang bị D2 (eq2)
  if (item_type === 'eq2') {
    let inv = playerObj.eq2_inv;
    if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
    inv = Array.isArray(inv) ? inv : [];
    const targetId = String(item_slot || item_id);
    const idx = inv.findIndex(x => x && (String(x.id) === targetId || String(x) === targetId));
    if (idx === -1) {
      return { ok: false, error: "Không tìm thấy trang bị trong túi đồ để bán!" };
    }
    const targetItem = inv.splice(idx, 1)[0];
    playerObj.eq2_inv = JSON.stringify(inv);
    const payloadStr = itemData.item_payload || JSON.stringify(targetItem);
    return { ok: true, name: item_name || `Trang bị T${targetItem.t || 1}`, payload: payloadStr };
  }

  // 8. Đồ sưu tầm (treasure, hardware, weapon_parts, house_parts, stat_parts)
  if (COLLECTIBLE_FIELDS[item_type]) {
    const listField = COLLECTIBLE_FIELDS[item_type];
    const qtyField = `${listField}_qty`;
    let list = playerObj[listField];
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch(e) { list = []; } }
    list = Array.isArray(list) ? list : [];

    let qtyMap = playerObj[qtyField];
    if (typeof qtyMap === 'string') { try { qtyMap = JSON.parse(qtyMap || '{}'); } catch(e) { qtyMap = {}; } }
    qtyMap = qtyMap || {};

    const targetId = parseInt(item_id);
    const extraQty = parseInt(qtyMap[targetId]) || 0;
    const totalOwned = (list.includes(targetId) ? 1 : 0) + extraQty;

    if (totalOwned < qty) {
      return { ok: false, error: "Bạn không có đủ vật phẩm sưu tầm để bán!" };
    }

    let rem = qty;
    if (extraQty >= rem) {
      qtyMap[targetId] = extraQty - rem;
      rem = 0;
    } else {
      rem -= extraQty;
      delete qtyMap[targetId];
    }
    if (rem > 0) {
      list = list.filter(id => id !== targetId);
    }
    playerObj[listField] = JSON.stringify(list);
    playerObj[qtyField] = JSON.stringify(qtyMap);
    return { ok: true, name: item_name || `Vật phẩm #${targetId}` };
  }

  // 9. Trang bị cổ điển (equipment)
  if (item_type === 'equipment') {
    let eq = playerObj.equipment;
    if (typeof eq === 'string') { try { eq = JSON.parse(eq || '{}'); } catch(e) { eq = {}; } }
    eq = eq || {};

    let eqQty = playerObj.equipment_qty;
    if (typeof eqQty === 'string') { try { eqQty = JSON.parse(eqQty || '{}'); } catch(e) { eqQty = {}; } }
    eqQty = eqQty || {};

    const slot = item_slot || 'head';
    const tier = parseInt(item_tier) || 1;
    let slotArr = Array.isArray(eq[slot]) ? eq[slot] : [];
    let slotQty = eqQty[slot] || {};
    const extra = parseInt(slotQty[tier]) || 0;
    const total = (slotArr.includes(tier) ? 1 : 0) + extra;

    if (total < qty) {
      return { ok: false, error: "Bạn không có đủ trang bị để bán!" };
    }

    let rem = qty;
    if (extra >= rem) {
      slotQty[tier] = extra - rem;
      rem = 0;
    } else {
      rem -= extra;
      delete slotQty[tier];
    }
    if (rem > 0) {
      slotArr = slotArr.filter(t => t !== tier);
    }
    eq[slot] = slotArr;
    eqQty[slot] = slotQty;
    playerObj.equipment = JSON.stringify(eq);
    playerObj.equipment_qty = JSON.stringify(eqQty);
    return { ok: true, name: item_name || `Trang bị ${slot} T${tier}` };
  }

  return { ok: false, error: "Loại vật phẩm không được hỗ trợ để đăng bán!" };
}

// Cộng vật phẩm vào túi đồ người chơi (khi mua hàng hoặc hủy listing)
function addItemToPlayer(playerObj, itemData, isRefund = false) {
  const item_type = itemData.item_type;
  const item_id = itemData.item_id;
  const item_slot = itemData.item_slot;
  const item_tier = itemData.item_tier;
  const qty = parseInt(itemData.qty) || 1;

  // 1. Thẻ bài (card)
  if (item_type === 'card') {
    let cards = playerObj.cards;
    if (typeof cards === 'string') { try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; } }
    cards = cards || {};
    const cardId = parseInt(item_id);
    const cardObj = cards[cardId] || { n: 0, m: 0 };
    const isMvp = item_slot === 'mvp';
    if (isMvp) cardObj.m = (cardObj.m || 0) + qty;
    else cardObj.n = (cardObj.n || 0) + qty;
    cards[cardId] = cardObj;
    playerObj.cards = JSON.stringify(cards);
    return { ok: true };
  }

  // 2. Trứng thú cưng (egg)
  if (item_type === 'egg') {
    let eggs = playerObj.eggs;
    if (typeof eggs === 'string') { try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; } }
    eggs = eggs || {};
    const eggId = parseInt(item_id);
    const eggObj = eggs[eggId] || { n: 0, m: 0 };
    const isMvp = item_slot === 'mvp';
    if (isMvp) eggObj.m = (eggObj.m || 0) + qty;
    else eggObj.n = (eggObj.n || 0) + qty;
    eggs[eggId] = eggObj;
    playerObj.eggs = JSON.stringify(eggs);
    return { ok: true };
  }

  // 3. Module vũ khí (module_*)
  if (item_type && item_type.startsWith('module_') && item_type !== 'module_box') {
    const weapon = item_type.replace('module_', '');
    const invField = MOD_INV_FIELDS[weapon];
    if (!invField) {
      return { ok: false, error: "Loại module không hợp lệ!" };
    }
    let inv = playerObj[invField];
    if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
    inv = Array.isArray(inv) ? inv : [];

    if (inv.length >= 30 && !isRefund) {
      return { ok: false, error: "Hòm đồ của bạn đã đầy (tối đa 30), không thể mua thêm module!" };
    }

    let moduleObj = null;
    try {
      moduleObj = typeof itemData.item_payload === 'string' ? JSON.parse(itemData.item_payload) : itemData.item_payload;
    } catch(e) {}

    if (!moduleObj) {
      moduleObj = {
        slot: item_slot || 'barrel',
        rarity: parseInt(item_tier) || 1,
        plus: 0,
        stat: null
      };
    }

    inv.push(moduleObj);
    playerObj[invField] = JSON.stringify(inv);
    return { ok: true };
  }

  // 4. Hộp quà ngẫu nhiên (module_box, card_box, egg_box, module)
  if (item_type === 'module' || item_type === 'module_box' || item_type === 'card_box' || item_type === 'egg_box') {
    const actualType = (item_type === 'module') ? 'module_box' : item_type;
    const tier = parseInt(item_tier) || parseInt(item_id) || 1;
    const boxField = `${actualType}${tier}`;
    playerObj[boxField] = (parseInt(playerObj[boxField]) || 0) + qty;
    return { ok: true };
  }

  // 5. Tài nguyên, Kim cương, Quặng không gian (resource, diamond, ore)
  if (item_type === 'resource' || item_type === 'diamond' || item_type === 'ore') {
    const field = item_slot || item_id;
    playerObj[field] = (parseInt(playerObj[field]) || 0) + qty;
    return { ok: true };
  }

  // 6. Đạn (ammo)
  if (item_type === 'ammo') {
    const gun = item_slot || 'pistol';
    const tier = parseInt(item_tier) || 1;
    if (tier <= 1) {
      const k = 'ammo_' + (gun === 'robot' ? 'robot_gun' : gun);
      playerObj[k] = (parseInt(playerObj[k]) || 0) + qty;
    } else {
      const f = 'ammo_' + (gun === 'robot' ? 'robot' : gun) + '_extra';
      let extra = playerObj[f];
      if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch(e) { extra = []; } }
      extra = Array.isArray(extra) ? extra : [];
      const idx = tier - 2;
      while (extra.length <= idx) extra.push(0);
      extra[idx] = (parseInt(extra[idx]) || 0) + qty;
      playerObj[f] = JSON.stringify(extra);
    }
    return { ok: true };
  }

  // 7. Trang bị D2 (eq2)
  if (item_type === 'eq2') {
    let inv = playerObj.eq2_inv;
    if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
    inv = Array.isArray(inv) ? inv : [];
    let eq2Obj = null;
    try {
      eq2Obj = typeof itemData.item_payload === 'string' ? JSON.parse(itemData.item_payload) : itemData.item_payload;
    } catch(e) {}
    if (!eq2Obj) {
      eq2Obj = {
        id: Date.now().toString(36),
        t: parseInt(item_tier) || 1,
        s: item_slot || 'head'
      };
    }
    inv.push(eq2Obj);
    playerObj.eq2_inv = JSON.stringify(inv);
    return { ok: true };
  }

  // 8. Đồ sưu tầm (treasure, hardware, weapon_parts, house_parts, stat_parts)
  if (COLLECTIBLE_FIELDS[item_type]) {
    const listField = COLLECTIBLE_FIELDS[item_type];
    const qtyField = `${listField}_qty`;
    let list = playerObj[listField];
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch(e) { list = []; } }
    list = Array.isArray(list) ? list : [];

    let qtyMap = playerObj[qtyField];
    if (typeof qtyMap === 'string') { try { qtyMap = JSON.parse(qtyMap || '{}'); } catch(e) { qtyMap = {}; } }
    qtyMap = qtyMap || {};

    const targetId = parseInt(item_id);
    if (!list.includes(targetId)) {
      list.push(targetId);
      if (qty > 1) {
        qtyMap[targetId] = (parseInt(qtyMap[targetId]) || 0) + (qty - 1);
      }
    } else {
      qtyMap[targetId] = (parseInt(qtyMap[targetId]) || 0) + qty;
    }
    playerObj[listField] = JSON.stringify(list);
    playerObj[qtyField] = JSON.stringify(qtyMap);
    return { ok: true };
  }

  // 9. Trang bị cổ điển (equipment)
  if (item_type === 'equipment') {
    let eq = playerObj.equipment;
    if (typeof eq === 'string') { try { eq = JSON.parse(eq || '{}'); } catch(e) { eq = {}; } }
    eq = eq || {};

    let eqQty = playerObj.equipment_qty;
    if (typeof eqQty === 'string') { try { eqQty = JSON.parse(eqQty || '{}'); } catch(e) { eqQty = {}; } }
    eqQty = eqQty || {};

    const slot = item_slot || 'head';
    const tier = parseInt(item_tier) || 1;
    let slotArr = Array.isArray(eq[slot]) ? eq[slot] : [];
    let slotQty = eqQty[slot] || {};

    if (!slotArr.includes(tier)) {
      slotArr.push(tier);
      if (qty > 1) {
        slotQty[tier] = (parseInt(slotQty[tier]) || 0) + (qty - 1);
      }
    } else {
      slotQty[tier] = (parseInt(slotQty[tier]) || 0) + qty;
    }
    eq[slot] = slotArr;
    eqQty[slot] = slotQty;
    playerObj.equipment = JSON.stringify(eq);
    playerObj.equipment_qty = JSON.stringify(eqQty);
    return { ok: true };
  }

  return { ok: false, error: "Loại vật phẩm không được hỗ trợ để nhận!" };
}

// Đồng bộ dữ liệu player vào cấu trúc db.data
function syncPlayerToDb(dbData, lineUid, playerObj) {
  const p = (dbData.players || []).find(x => x.line_uid === lineUid);
  if (p) {
    p.raw_data = JSON.stringify(playerObj);
    if (playerObj.exp !== undefined) p.exp = playerObj.exp;
    if (playerObj.gold !== undefined) p.gold = playerObj.gold;
    if (playerObj.lv !== undefined) p.lv = playerObj.lv;
    if (playerObj.map !== undefined) p.map = playerObj.map;
    if (playerObj.name !== undefined) p.name = playerObj.name;
  }
}

// Thực thi giao dịch nguyên tử (Atomic Transaction): snapshot toàn bộ db.data, commit khi mọi bước thành công, rollback nếu có lỗi
function executeAtomicTransaction(workFn) {
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));
  try {
    const result = workFn(db.data);
    if (!result || result.ok === false) {
      db.data = snapshot;
      return result || { ok: false, error: 'Thao tác thất bại' };
    }
    db.save();
    return result;
  } catch (err) {
    db.data = snapshot;
    try {
      db.save();
    } catch (saveErr) {
      console.error('[Market Rollback] Lỗi khi lưu rollback snapshot:', saveErr);
    }
    return { ok: false, error: 'Lỗi giao dịch: ' + (err.message || 'Lỗi không xác định') };
  }
}

router.post('/', async (req, res) => {
  const { line_uid, session_token, action, listing_id, qty } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  try {
    db.load();
    seedMarketListings();

    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    // 1. Lấy danh sách hàng bán trên chợ (get_listings)
    if (action === 'get_listings') {
      const list = db.data.market_listings || [];
      const activeListings = list.filter(item => (parseInt(item.qty) || 0) > 0).map(formatListing);
      return res.json({
        ok: true,
        listings: activeListings
      });
    }

    // 2. Lấy danh sách hàng bán của chính mình (get_my_listings)
    if (action === 'get_my_listings') {
      const list = db.data.market_listings || [];
      const myListings = list.filter(item => item.seller_uid === line_uid && (parseInt(item.qty) || 0) > 0).map(formatListing);
      return res.json({
        ok: true,
        listings: myListings
      });
    }

    // 3. Mua hàng (buy) - Thực thi nguyên tử
    if (action === 'buy') {
      const targetId = parseInt(listing_id);
      if (isNaN(targetId)) {
        return res.json({ ok: false, error: "ID giao dịch không hợp lệ!" });
      }

      const txResult = executeAtomicTransaction((dbData) => {
        const listings = dbData.market_listings || [];
        const itemIdx = listings.findIndex(x => x.id === targetId);

        if (itemIdx === -1 || (parseInt(listings[itemIdx].qty) || 0) <= 0) {
          return { ok: false, error: "Vật phẩm đã được bán hoặc không tồn tại!" };
        }

        const item = listings[itemIdx];

        // Chặn mua listing của chính mình
        if (item.seller_uid === line_uid) {
          return { ok: false, error: "Bạn không thể mua vật phẩm của chính mình!" };
        }

        const buyQty = Math.max(1, parseInt(qty) || 1);
        if (item.qty < buyQty) {
          return { ok: false, error: "Số lượng trên chợ không đủ!" };
        }

        const totalCost = item.price_per * buyQty;
        const buyerPlayerRow = (dbData.players || []).find(p => p.line_uid === line_uid);
        if (!buyerPlayerRow) {
          return { ok: false, error: "Không tìm thấy dữ liệu người mua!" };
        }

        let buyerObj;
        try {
          buyerObj = JSON.parse(buyerPlayerRow.raw_data);
        } catch (e) {
          return { ok: false, error: "Dữ liệu người mua không hợp lệ!" };
        }

        const playerGold = buyerObj.gold || 0;
        if (playerGold < totalCost) {
          return { ok: false, error: "Bạn không đủ Vàng để mua!" };
        }

        // Validate người bán trước khi giao dịch nếu không phải NPC
        let sellerObj = null;
        if (item.seller_uid !== 'npc') {
          const sellerRow = (dbData.players || []).find(p => p.line_uid === item.seller_uid);
          if (!sellerRow) {
            return { ok: false, error: "Người bán không tồn tại hoặc tài khoản đã bị xóa!" };
          }
          try {
            sellerObj = JSON.parse(sellerRow.raw_data);
          } catch (e) {
            return { ok: false, error: "Dữ liệu người bán không hợp lệ!" };
          }
        }

        // Thêm vật phẩm vào túi người mua
        const addRes = addItemToPlayer(buyerObj, { ...item, qty: buyQty }, false);
        if (!addRes.ok) {
          return { ok: false, error: addRes.error || "Không thể nhận vật phẩm!" };
        }

        // Trừ tiền người mua
        buyerObj.gold = playerGold - totalCost;

        // Trả tiền cho người bán
        if (sellerObj) {
          sellerObj.gold = (sellerObj.gold || 0) + totalCost;
          syncPlayerToDb(dbData, item.seller_uid, sellerObj);
        }

        // Ghi nhận lịch sử giao dịch
        if (!dbData.market_history) dbData.market_history = [];
        const histId = (dbData.market_history.length > 0 ? Math.max(...dbData.market_history.map(x => x.id || 0)) : 0) + 1;
        dbData.market_history.push({
          id: histId,
          listing_id: item.id,
          item_name: item.item_name,
          item_type: item.item_type,
          item_id: item.item_id,
          item_icon: item.item_icon || '📦',
          item_rarity: item.item_rarity || 'white',
          qty: buyQty,
          price_per: item.price_per,
          gold_amount: totalCost,
          seller_uid: item.seller_uid,
          seller_name: item.seller_name || 'NPC',
          buyer_uid: line_uid,
          buyer_name: buyerObj.name || buyerPlayerRow.name || 'Người chơi',
          status: 'sold',
          created_at: Math.floor(Date.now() / 1000)
        });

        // Cập nhật số lượng listing trên chợ
        item.qty -= buyQty;
        if (item.qty <= 0) {
          listings.splice(itemIdx, 1);
        }
        dbData.market_listings = listings;

        // Cập nhật dữ liệu người mua vào dbData
        syncPlayerToDb(dbData, line_uid, buyerObj);

        return {
          ok: true,
          player: buyerObj,
          msg: `Mua thành công ${buyQty}x ${item.item_name}!`
        };
      });

      return res.json(txResult);
    }

    // 4. Đăng bán vật phẩm (sell) - Thực thi nguyên tử
    if (action === 'sell') {
      const { item_type, item_id, qty: sellQtyRaw, price_per: priceRaw, item_slot, item_name, item_desc, item_icon, item_rarity, item_payload, item_tier } = req.body;
      const sellQty = Math.max(1, parseInt(sellQtyRaw) || 1);
      const price = Math.max(1, parseInt(priceRaw) || 1);

      const txResult = executeAtomicTransaction((dbData) => {
        const sellerPlayerRow = (dbData.players || []).find(p => p.line_uid === line_uid);
        if (!sellerPlayerRow) {
          return { ok: false, error: "Không tìm thấy dữ liệu người chơi!" };
        }

        let sellerObj;
        try {
          sellerObj = JSON.parse(sellerPlayerRow.raw_data);
        } catch (e) {
          return { ok: false, error: "Dữ liệu người chơi không hợp lệ!" };
        }

        const deductRes = deductItemFromPlayer(sellerObj, {
          item_type,
          item_id,
          item_slot,
          item_tier,
          item_name,
          item_desc,
          item_payload,
          qty: sellQty
        });

        if (!deductRes.ok) {
          return { ok: false, error: deductRes.error || "Bạn không có đủ vật phẩm trong hòm đồ để bán!" };
        }

        const name = deductRes.name || item_name || "Vật phẩm";
        const payload = deductRes.payload !== undefined ? deductRes.payload : (item_payload || null);

        // Tạo listing mới trên chợ
        if (!dbData.market_listings) dbData.market_listings = [];
        const listings = dbData.market_listings;
        const nextId = listings.length > 0 ? Math.max(...listings.map(x => x.id || 0)) + 1 : 1000;
        const now = Math.floor(Date.now() / 1000);

        listings.push({
          id: nextId,
          item_name: name,
          item_type: item_type,
          item_id: isNaN(parseInt(item_id)) ? item_id : parseInt(item_id),
          item_slot: item_slot || 'normal',
          item_tier: parseInt(item_tier) || 0,
          item_icon: item_icon || (item_type === 'egg' ? '🥚' : (item_type === 'card' ? '🎴' : (item_type && item_type.startsWith('module_') ? '🔧' : '📦'))),
          item_desc: item_desc || '',
          item_rarity: item_rarity || 'white',
          item_payload: payload,
          price_per: price,
          qty: sellQty,
          seller_uid: line_uid,
          seller_name: sellerObj.name || sellerPlayerRow.name || 'Người chơi',
          expires_at: now + 86400 * 7,
          created_at: now
        });
        dbData.market_listings = listings;

        syncPlayerToDb(dbData, line_uid, sellerObj);

        return {
          ok: true,
          player: sellerObj,
          msg: `Đã đăng bán ${sellQty}x ${name} với giá ${price} Gold/cái lên chợ!`
        };
      });

      return res.json(txResult);
    }

    // 5. Hủy đăng bán (cancel) - Thực thi nguyên tử
    if (action === 'cancel') {
      const targetId = parseInt(listing_id);
      if (isNaN(targetId)) {
        return res.json({ ok: false, error: "ID giao dịch không hợp lệ!" });
      }

      const txResult = executeAtomicTransaction((dbData) => {
        const listings = dbData.market_listings || [];
        const itemIdx = listings.findIndex(x => x.id === targetId);

        if (itemIdx === -1) {
          return { ok: false, error: "Giao dịch không tồn tại hoặc đã kết thúc!" };
        }

        const item = listings[itemIdx];

        if (item.seller_uid !== line_uid) {
          return { ok: false, error: "Chỉ người bán mới có quyền hủy giao dịch này!" };
        }

        const sellerPlayerRow = (dbData.players || []).find(p => p.line_uid === line_uid);
        if (!sellerPlayerRow) {
          return { ok: false, error: "Không tìm thấy dữ liệu người bán!" };
        }

        let sellerObj;
        try {
          sellerObj = JSON.parse(sellerPlayerRow.raw_data);
        } catch (e) {
          return { ok: false, error: "Dữ liệu người bán không hợp lệ!" };
        }

        const refundRes = addItemToPlayer(sellerObj, item, true);
        if (!refundRes.ok) {
          return { ok: false, error: refundRes.error || "Không thể hoàn trả vật phẩm!" };
        }

        // Xóa khỏi danh sách listing
        listings.splice(itemIdx, 1);
        dbData.market_listings = listings;

        // Ghi log lịch sử hủy
        if (!dbData.market_history) dbData.market_history = [];
        const histId = (dbData.market_history.length > 0 ? Math.max(...dbData.market_history.map(x => x.id || 0)) : 0) + 1;
        dbData.market_history.push({
          id: histId,
          listing_id: item.id,
          item_name: item.item_name,
          item_type: item.item_type,
          item_id: item.item_id,
          item_icon: item.item_icon || '📦',
          item_rarity: item.item_rarity || 'white',
          qty: item.qty,
          price_per: item.price_per,
          gold_amount: 0,
          seller_uid: line_uid,
          seller_name: sellerObj.name || sellerPlayerRow.name || 'Người chơi',
          buyer_uid: null,
          buyer_name: '',
          status: 'cancelled',
          created_at: Math.floor(Date.now() / 1000)
        });

        syncPlayerToDb(dbData, line_uid, sellerObj);

        return {
          ok: true,
          player: sellerObj,
          msg: `Đã hủy bán ${item.item_name} và nhận lại vật phẩm!`
        };
      });

      return res.json(txResult);
    }

    // 6. Lấy lịch sử giao dịch (get_history)
    if (action === 'get_history') {
      const historyList = db.data.market_history || [];
      const userRows = [];

      for (const entry of historyList) {
        if (entry.seller_uid === line_uid) {
          if (entry.status === 'sold') {
            userRows.push({
              id: entry.id,
              created_at: entry.created_at,
              status: 'sold',
              item_name: entry.item_name,
              item_type: entry.item_type,
              item_icon: entry.item_icon || '📦',
              item_rarity: entry.item_rarity || 'white',
              qty: entry.qty,
              gold_change: entry.gold_amount || 0,
              counterpart_name: entry.buyer_name || 'Người mua'
            });
          } else if (entry.status === 'cancelled') {
            userRows.push({
              id: entry.id,
              created_at: entry.created_at,
              status: 'cancelled',
              item_name: entry.item_name,
              item_type: entry.item_type,
              item_icon: entry.item_icon || '📦',
              item_rarity: entry.item_rarity || 'white',
              qty: entry.qty,
              gold_change: 0,
              counterpart_name: ''
            });
          }
        } else if (entry.buyer_uid === line_uid) {
          userRows.push({
            id: entry.id,
            created_at: entry.created_at,
            status: 'bought',
            item_name: entry.item_name,
            item_type: entry.item_type,
            item_icon: entry.item_icon || '📦',
            item_rarity: entry.item_rarity || 'white',
            qty: entry.qty,
            gold_change: -(entry.gold_amount || 0),
            counterpart_name: entry.seller_name || 'Người bán'
          });
        }
      }

      // Sắp xếp mới nhất lên đầu
      userRows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      const soldCount = userRows.filter(r => r.status === 'sold').length;
      const boughtCount = userRows.filter(r => r.status === 'bought').length;
      const totalIncome = userRows.reduce((sum, r) => sum + (r.gold_change || 0), 0);

      const summary = {
        income: totalIncome,
        sold_count: soldCount,
        bought_count: boughtCount
      };

      const requestedFilter = req.body.filter || 'all';
      let filteredRows = userRows;
      if (requestedFilter && requestedFilter !== 'all') {
        filteredRows = userRows.filter(r => r.status === requestedFilter);
      }

      return res.json({
        ok: true,
        rows: filteredRows,
        summary
      });
    }

    res.json({ ok: false, error: 'Unknown action' });
  } finally {
    release();
  }
});

module.exports = router;
