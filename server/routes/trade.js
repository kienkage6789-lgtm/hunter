const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// ── Quản lý In-Memory Active Sessions ──
// activeRooms: roomId -> roomObject
// userRooms: line_uid -> roomId
// pendingInvites: target_uid -> { tid, from_uid, from_name, created_at, expires_at }
// userSentInvites: from_uid -> target_uid
const activeRooms = new Map();
const userRooms = new Map();
const pendingInvites = new Map();
const userSentInvites = new Map();

// Deadlock-free two-user locking: luôn sắp xếp UIDs theo thứ tự từ điển
async function acquireTwoLocks(uidA, uidB) {
  if (!uidA && !uidB) return () => {};
  if (!uidA) return await acquireLock(uidB);
  if (!uidB || uidA === uidB) return await acquireLock(uidA);

  const [first, second] = [uidA, uidB].sort();
  const rel1 = await acquireLock(first);
  const rel2 = await acquireLock(second);

  return () => {
    try { rel2(); } catch (e) {}
    try { rel1(); } catch (e) {}
  };
}

// Danh mục trường module và đồ sưu tầm
const MOD_INV_FIELDS = {
  sniper: 'sniper_module_inventory',
  knife: 'knife_module_inventory',
  axe: 'axe_module_inventory',
  robot: 'robot_module_inventory',
  armor: 'armor_module_inventory',
  house: 'house_module_inventory',
  robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory',
  turret: 'turret_module_inventory',
  pistol: 'module_inventory',
  '': 'module_inventory'
};

const COLLECTIBLE_FIELDS = {
  treasure: 'treasures',
  hardware: 'hardware',
  weapon_parts: 'weapon_parts',
  house_parts: 'house_parts',
  stat_parts: 'stat_parts'
};

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

// Thực thi transaction nguyên tử (Atomic Transaction): snapshot toàn bộ db.data, commit khi mọi bước thành công, rollback nếu có lỗi
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
      console.error('[Trade Rollback] Lỗi khi lưu rollback snapshot:', saveErr);
    }
    return { ok: false, error: 'Lỗi giao dịch: ' + (err.message || 'Lỗi không xác định') };
  }
}

// Khấu trừ vật phẩm từ túi đồ người chơi (Escrow)
function deductItemFromPlayer(playerObj, itemData) {
  const item_type = itemData.item_type;
  const item_id = itemData.item_id;
  const item_slot = itemData.item_slot;
  const item_tier = itemData.item_tier;
  const item_name = itemData.item_name;
  const qty = Math.max(1, parseInt(itemData.qty) || 1);

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
      return { ok: false, error: "Bạn không có đủ thẻ bài để giao dịch!" };
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
      return { ok: false, error: "Bạn không có đủ trứng thú cưng để giao dịch!" };
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
      const findIdx = inv.findIndex(m => m && (!item_slot || m.slot === item_slot));
      if (findIdx !== -1) {
        targetMod = inv.splice(findIdx, 1)[0];
      }
    }

    if (!targetMod) {
      return { ok: false, error: "Không tìm thấy module phù hợp trong hòm đồ!" };
    }

    playerObj[invField] = JSON.stringify(inv);
    const payloadStr = itemData.item_payload || JSON.stringify(targetMod);
    return {
      ok: true,
      name: item_name || `Module T${targetMod.t || targetMod.rarity || 1} (${targetMod.slot})`,
      payload: payloadStr
    };
  }

  // 4. Hộp quà (module_box, card_box, egg_box, module)
  if (item_type === 'module' || item_type === 'module_box' || item_type === 'card_box' || item_type === 'egg_box') {
    const actualType = (item_type === 'module') ? 'module_box' : item_type;
    const tier = parseInt(item_tier) || parseInt(item_id) || 1;
    const boxField = `${actualType}${tier}`;
    const available = parseInt(playerObj[boxField]) || 0;
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ hộp quà trong túi đồ!" };
    }
    playerObj[boxField] = available - qty;
    const boxLabel = actualType === 'module_box' ? 'Module' : (actualType === 'card_box' ? 'Thẻ bài' : 'Trứng');
    return { ok: true, name: item_name || `Hộp ${boxLabel} T${tier}` };
  }

  // 5. Tài nguyên, Kim cương, Quặng không gian (resource, diamond, ore)
  if (item_type === 'resource' || item_type === 'diamond' || item_type === 'ore') {
    let field = (item_id && isNaN(parseInt(item_id))) ? item_id : (item_slot && item_slot !== 'normal' ? item_slot : item_id);
    const available = parseInt(playerObj[field]) || 0;
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ tài nguyên trong túi đồ!" };
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
        return { ok: false, error: "Bạn không có đủ đạn để giao dịch!" };
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
        return { ok: false, error: "Bạn không có đủ đạn cấp cao để giao dịch!" };
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
      return { ok: false, error: "Không tìm thấy trang bị trong túi đồ!" };
    }
    const targetItem = inv.splice(idx, 1)[0];
    playerObj.eq2_inv = JSON.stringify(inv);
    const payloadStr = itemData.item_payload || JSON.stringify(targetItem);
    return { ok: true, name: item_name || `Trang bị T${targetItem.t || 1}`, payload: payloadStr };
  }

  // 8. Đồ sưu tầm (collectibles)
  if (COLLECTIBLE_FIELDS[item_type]) {
    const listField = COLLECTIBLE_FIELDS[item_type];
    let list = playerObj[listField];
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch(e) { list = []; } }
    list = Array.isArray(list) ? list : [];
    const targetId = parseInt(item_id);
    const idx = list.indexOf(targetId);
    if (idx === -1) {
      return { ok: false, error: "Không tìm thấy vật phẩm sưu tầm trong kho!" };
    }
    list.splice(idx, 1);
    playerObj[listField] = JSON.stringify(list);
    return { ok: true, name: item_name || `Vật phẩm sưu tầm #${targetId}` };
  }

  // Fallback nếu item_type khớp với cột trực tiếp trong playerObj
  if (playerObj[item_type] !== undefined) {
    const available = parseInt(playerObj[item_type]) || 0;
    if (available < qty) {
      return { ok: false, error: "Bạn không có đủ số lượng để giao dịch!" };
    }
    playerObj[item_type] = available - qty;
    return { ok: true, name: item_name || item_type };
  }

  return { ok: false, error: "Loại vật phẩm không được hỗ trợ để giao dịch!" };
}

// Thêm vật phẩm vào túi đồ người chơi (khi hoàn tất hoặc hoàn trả)
function addItemToPlayer(playerObj, itemData, isRefund = false) {
  const item_type = itemData.item_type;
  const item_id = itemData.item_id;
  const item_slot = itemData.item_slot;
  const item_tier = itemData.item_tier;
  const qty = Math.max(1, parseInt(itemData.qty || itemData.q) || 1);

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
    if (!invField) return { ok: false, error: "Loại module không hợp lệ!" };

    let inv = playerObj[invField];
    if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
    inv = inv || [];

    if (inv.length >= 30 && !isRefund) {
      return { ok: false, error: "Hòm đồ module đã đầy (tối đa 30)!" };
    }

    let modObj = null;
    if (itemData.item_payload) {
      try {
        modObj = typeof itemData.item_payload === 'object' ? itemData.item_payload : JSON.parse(itemData.item_payload);
      } catch (e) {}
    }
    if (!modObj) {
      modObj = {
        slot: item_slot || 'barrel',
        rarity: parseInt(item_tier) || 1,
        plus: 0,
        stat: null,
        cards: []
      };
    }
    inv.push(modObj);
    playerObj[invField] = JSON.stringify(inv);
    return { ok: true };
  }

  // 4. Hộp quà (module_box, card_box, egg_box, module)
  if (item_type === 'module' || item_type === 'module_box' || item_type === 'card_box' || item_type === 'egg_box') {
    const actualType = (item_type === 'module') ? 'module_box' : item_type;
    const tier = parseInt(item_tier) || parseInt(item_id) || 1;
    const boxField = `${actualType}${tier}`;
    playerObj[boxField] = (parseInt(playerObj[boxField]) || 0) + qty;
    return { ok: true };
  }

  // 5. Tài nguyên, Kim cương, Quặng không gian (resource, diamond, ore)
  if (item_type === 'resource' || item_type === 'diamond' || item_type === 'ore') {
    let field = (item_id && isNaN(parseInt(item_id))) ? item_id : (item_slot && item_slot !== 'normal' ? item_slot : item_id);
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
    let eqObj = null;
    if (itemData.item_payload) {
      try {
        eqObj = typeof itemData.item_payload === 'object' ? itemData.item_payload : JSON.parse(itemData.item_payload);
      } catch (e) {}
    }
    if (!eqObj) {
      eqObj = {
        id: 'eq_' + Date.now().toString(36),
        s: item_slot || 'head',
        t: parseInt(item_tier) || 1,
        lv: 1,
        af: []
      };
    }
    inv.push(eqObj);
    playerObj.eq2_inv = JSON.stringify(inv);
    return { ok: true };
  }

  // 8. Đồ sưu tầm (collectibles)
  if (COLLECTIBLE_FIELDS[item_type]) {
    const listField = COLLECTIBLE_FIELDS[item_type];
    let list = playerObj[listField];
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch(e) { list = []; } }
    list = Array.isArray(list) ? list : [];
    const targetId = parseInt(item_id);
    if (!list.includes(targetId)) {
      list.push(targetId);
    }
    playerObj[listField] = JSON.stringify(list);
    return { ok: true };
  }

  // Fallback cột trực tiếp
  if (playerObj[item_type] !== undefined) {
    playerObj[item_type] = (parseInt(playerObj[item_type]) || 0) + qty;
    return { ok: true };
  }

  return { ok: false, error: "Loại vật phẩm không được hỗ trợ để nhận!" };
}

// ── Tính phí giao dịch P (Trade Fee Calculation) ──
function calcTradeFee(u1Esc, u1Gold, u2Esc, u2Gold) {
  let feePoints = 10; // Phí cơ bản 10 P
  const br = [];

  const checkOffer = (esc, gold) => {
    if (gold && gold >= 50000) {
      feePoints += 5;
      br.push({ k: 'ทอง', p: 5 });
    }
    if (!esc) return;

    const t = esc.item_type || '';
    const isMvp = esc.item_slot === 'mvp';

    if (t === 'card' || t === 'egg') {
      if (isMvp) {
        feePoints += 20;
        br.push({ k: 'การ์ด/ไข่ MVP', p: 20 });
      } else {
        feePoints += 5;
        br.push({ k: 'การ์ด/ไข่', p: 5 });
      }
    } else if (t === 'diamond') {
      feePoints += 5;
      br.push({ k: 'เพชร', p: 5 });
    } else if (t.startsWith('module_') || t === 'module') {
      feePoints += 5;
      br.push({ k: 'โมดูล', p: 5 });
    } else if (t === 'module_box' || t === 'card_box' || t === 'egg_box') {
      feePoints += 5;
      br.push({ k: 'กล่อง', p: 5 });
    } else if (t === 'eq2' || t === 'equipment') {
      feePoints += 10;
      br.push({ k: 'ของสวมใส่', p: 10 });
    } else if (COLLECTIBLE_FIELDS[t]) {
      feePoints += 10;
      br.push({ k: 'ของวิเศษ', p: 10 });
    }
  };

  checkOffer(u1Esc, u1Gold);
  checkOffer(u2Esc, u2Gold);

  const isCapped = feePoints >= 50;
  const finalP = Math.min(50, feePoints);

  return {
    p: finalP,
    base: 10,
    cap: isCapped ? 1 : 0,
    br: br
  };
}

// ── Format Room Object cho phía người gọi ──
function formatRoomFor(room, currentUid) {
  if (!room) return null;
  const isInitiator = room.initiator_uid === currentUid;
  const me = room.u1.uid === currentUid ? room.u1 : room.u2;
  const other = room.u1.uid === currentUid ? room.u2 : room.u1;

  return {
    id: room.id,
    st: room.st,
    ver: room.ver || 1,
    partner: other.name,
    deadline: room.deadline,
    initiator: isInitiator,
    me: {
      locked: !!me.locked,
      confirm: !!me.confirm,
      esc: me.esc || null,
      gold: me.gold || 0
    },
    other: {
      locked: !!other.locked,
      confirm: !!other.confirm,
      esc: other.esc || null,
      gold: other.gold || 0
    },
    fee: room.fee || { p: 10, base: 10, cap: 0, br: [] }
  };
}

// ── Kiểm tra và xử lý timeout phòng giao dịch ──
async function checkRoomTimeout(room) {
  if (!room || room.st !== 'room') return;
  const now = Math.floor(Date.now() / 1000);
  if (now <= room.deadline) return;

  // Hết hạn phòng: hoàn trả escrow nguyên tử
  const release = await acquireTwoLocks(room.u1.uid, room.u2.uid);
  try {
    if (room.st !== 'room') return;

    const txRes = executeAtomicTransaction((dbData) => {
      // Hoàn trả u1 nếu đã lock
      if (room.u1.locked) {
        const u1Row = (dbData.players || []).find(p => p.line_uid === room.u1.uid);
        if (u1Row) {
          try {
            const p1 = JSON.parse(u1Row.raw_data);
            if (room.u1.esc) addItemToPlayer(p1, room.u1.esc, true);
            if (room.u1.gold) p1.gold = (p1.gold || 0) + room.u1.gold;
            syncPlayerToDb(dbData, room.u1.uid, p1);
          } catch (e) {
            return { ok: false, error: 'Lỗi hoàn trả player 1' };
          }
        }
      }

      // Hoàn trả u2 nếu đã lock
      if (room.u2.locked) {
        const u2Row = (dbData.players || []).find(p => p.line_uid === room.u2.uid);
        if (u2Row) {
          try {
            const p2 = JSON.parse(u2Row.raw_data);
            if (room.u2.esc) addItemToPlayer(p2, room.u2.esc, true);
            if (room.u2.gold) p2.gold = (p2.gold || 0) + room.u2.gold;
            syncPlayerToDb(dbData, room.u2.uid, p2);
          } catch (e) {
            return { ok: false, error: 'Lỗi hoàn trả player 2' };
          }
        }
      }

      // Ghi lịch sử timeout
      if (!dbData.trade_history) dbData.trade_history = [];
      const nextId = (dbData.trade_history.length > 0 ? Math.max(...dbData.trade_history.map(x => x.id || 0)) : 0) + 1;
      dbData.trade_history.push({
        id: nextId,
        room_id: room.id,
        status: 'timeout',
        u1_uid: room.u1.uid,
        u1_name: room.u1.name,
        u2_uid: room.u2.uid,
        u2_name: room.u2.name,
        u1_esc: room.u1.esc,
        u1_gold: room.u1.gold || 0,
        u2_esc: room.u2.esc,
        u2_gold: room.u2.gold || 0,
        fee: 0,
        created_at: now
      });

      return { ok: true };
    });

    if (txRes && txRes.ok) {
      room.st = 'timeout';
      userRooms.delete(room.u1.uid);
      userRooms.delete(room.u2.uid);
    } else {
      console.error('[Trade Timeout] Hoàn trả timeout thất bại, giữ room để retry:', txRes ? txRes.error : 'Unknown error');
    }
  } finally {
    release();
  }
}

// ── Router chính Trade 1-1 ──
router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  db.load();
  const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!userRow) {
    return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
  }

  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.json({ ok: false, error: 'Player not found' });
  }

  // 1. Tìm kiếm người chơi (search & search_name)
  if (action === 'search' || action === 'search_name') {
    const q = (req.body.q || '').trim().toLowerCase();
    const allPlayers = db.data.players || [];
    const results = [];
    for (const m of allPlayers) {
      if (m.line_uid === line_uid) continue; // Không trade với chính mình
      const name = String(m.name || '');
      if (q && !name.toLowerCase().includes(q)) continue;
      let p; try { p = JSON.parse(m.raw_data); } catch(e) { p = {}; }
      results.push({
        uid: m.line_uid,
        id: m.line_uid,
        name: m.name,
        lv: m.lv || p.lv || 1,
        vip: p.vip_lv || 0
      });
      if (results.length >= 20) break;
    }
    return res.json({ ok: true, players: results, matches: results });
  }

  // 2. Lấy trạng thái hiện tại (status)
  if (action === 'status') {
    // Kiểm tra phòng đang hoạt động
    const roomId = userRooms.get(line_uid);
    if (roomId && activeRooms.has(roomId)) {
      const room = activeRooms.get(roomId);
      await checkRoomTimeout(room);
      if (room.st === 'room') {
        return res.json({ ok: true, st: 'room', room: formatRoomFor(room, line_uid) });
      } else if (room.st === 'done' || room.st === 'cancel' || room.st === 'timeout') {
        return res.json({ ok: true, st: 'ended', room: formatRoomFor(room, line_uid) });
      }
    }

    // Kiểm tra lời mời đã gửi
    if (userSentInvites.has(line_uid)) {
      const targetUid = userSentInvites.get(line_uid);
      const inv = pendingInvites.get(targetUid);
      if (inv && inv.from_uid === line_uid && Date.now() < inv.expires_at) {
        const targetRow = db.prepare('SELECT name FROM players WHERE line_uid = ?').get(targetUid);
        return res.json({ ok: true, st: 'sent', to_name: (targetRow && targetRow.name) || 'Người chơi' });
      } else {
        userSentInvites.delete(line_uid);
        if (inv && inv.from_uid === line_uid) pendingInvites.delete(targetUid);
      }
    }

    // Kiểm tra lời mời nhận được
    if (pendingInvites.has(line_uid)) {
      const inv = pendingInvites.get(line_uid);
      if (Date.now() < inv.expires_at) {
        return res.json({
          ok: true,
          st: 'invited',
          from_uid: inv.from_uid,
          from_name: inv.from_name,
          tid: inv.tid
        });
      } else {
        pendingInvites.delete(line_uid);
        userSentInvites.delete(inv.from_uid);
      }
    }

    return res.json({ ok: true, st: 'idle', room: null });
  }

  // 3. Gửi lời mời giao dịch (invite)
  if (action === 'invite') {
    const targetUid = req.body.target;
    if (!targetUid) {
      return res.json({ ok: false, error: 'Thiếu thông tin người nhận lời mời!' });
    }
    if (targetUid === line_uid) {
      return res.json({ ok: false, error: 'Không thể tự giao dịch với chính mình!' });
    }

    const targetRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(targetUid);
    if (!targetRow) {
      return res.json({ ok: false, error: 'Người chơi mục tiêu không tồn tại hoặc offline!' });
    }

    // Kiểm tra nếu 1 trong 2 đang trong phòng giao dịch
    if (userRooms.has(line_uid) && activeRooms.has(userRooms.get(line_uid))) {
      const r = activeRooms.get(userRooms.get(line_uid));
      if (r.st === 'room') return res.json({ ok: false, error: 'Bạn đang trong một phiên giao dịch khác!' });
    }
    if (userRooms.has(targetUid) && activeRooms.has(userRooms.get(targetUid))) {
      const r = activeRooms.get(userRooms.get(targetUid));
      if (r.st === 'room') return res.json({ ok: false, error: 'Người chơi này đang bận giao dịch!' });
    }

    const tid = 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const inviteObj = {
      tid,
      from_uid: line_uid,
      from_name: pRow.name || 'Người chơi',
      created_at: Date.now(),
      expires_at: Date.now() + 60000 // 60 giây
    };

    pendingInvites.set(targetUid, inviteObj);
    userSentInvites.set(line_uid, targetUid);

    return res.json({
      ok: true,
      st: 'sent',
      to_name: targetRow.name,
      tid
    });
  }

  // 4. Phản hồi lời mời (respond)
  if (action === 'respond') {
    const accept = parseInt(req.body.accept) === 1;
    const inv = pendingInvites.get(line_uid);

    if (!inv || Date.now() > inv.expires_at) {
      pendingInvites.delete(line_uid);
      return res.json({ ok: false, error: 'Lời mời giao dịch đã hết hạn hoặc không tồn tại!' });
    }

    const fromUid = inv.from_uid;
    pendingInvites.delete(line_uid);
    userSentInvites.delete(fromUid);

    if (!accept) {
      return res.json({ ok: true, st: 'idle', room: null, msg: 'Đã từ chối lời mời giao dịch.' });
    }

    // Kiểm tra người gửi lời mời
    const fromRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(fromUid);
    if (!fromRow) {
      return res.json({ ok: false, error: 'Người gửi lời mời không còn trực tuyến!' });
    }

    // Tạo phòng giao dịch mới
    const roomId = 'tr_room_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const nowSec = Math.floor(Date.now() / 1000);
    const room = {
      id: roomId,
      initiator_uid: fromUid,
      target_uid: line_uid,
      ver: 1,
      st: 'room',
      created_at: nowSec,
      deadline: nowSec + 180, // 3 phút
      u1: {
        uid: fromUid,
        name: fromRow.name || 'Người chơi 1',
        locked: false,
        confirm: false,
        esc: null,
        gold: 0
      },
      u2: {
        uid: line_uid,
        name: pRow.name || 'Người chơi 2',
        locked: false,
        confirm: false,
        esc: null,
        gold: 0
      },
      fee: {
        p: 10,
        base: 10,
        cap: 0,
        br: []
      }
    };

    activeRooms.set(roomId, room);
    userRooms.set(fromUid, roomId);
    userRooms.set(line_uid, roomId);

    return res.json({
      ok: true,
      st: 'room',
      room: formatRoomFor(room, line_uid)
    });
  }

  // Lấy phòng hiện tại của player cho các action trong phòng
  const roomId = userRooms.get(line_uid);
  const room = roomId ? activeRooms.get(roomId) : null;

  // 5. Khóa đề nghị giao dịch & Escrow (lock)
  if (action === 'lock') {
    if (!room || room.st !== 'room') {
      return res.json({ ok: false, error: 'Không tìm thấy phòng giao dịch đang hoạt động!' });
    }

    const release = await acquireTwoLocks(room.u1.uid, room.u2.uid);
    try {
      if (room.st !== 'room') {
        return res.json({ ok: false, error: 'Phòng giao dịch đã kết thúc!' });
      }

      const me = room.u1.uid === line_uid ? room.u1 : room.u2;
      if (me.locked) {
        return res.json({ ok: false, error: 'Bạn đã khóa đề nghị rồi!' });
      }

      const gold = Math.max(0, parseInt(req.body.gold) || 0);
      const { item_type, item_id, item_slot, item_tier, qty, item_icon, item_name, item_desc, item_rarity, item_payload } = req.body;

      if (!item_type && gold <= 0) {
        return res.json({ ok: false, error: 'Vui lòng đặt ít nhất 1 vật phẩm hoặc vàng để giao dịch!' });
      }

      const txRes = executeAtomicTransaction((dbData) => {
        const playerRow = (dbData.players || []).find(p => p.line_uid === line_uid);
        if (!playerRow) return { ok: false, error: 'Không tìm thấy người chơi!' };

        let playerObj;
        try { playerObj = JSON.parse(playerRow.raw_data); } catch(e) { return { ok: false, error: 'Dữ liệu người chơi lỗi!' }; }

        if (gold > 0) {
          const curGold = parseInt(playerObj.gold) || 0;
          if (curGold < gold) {
            return { ok: false, error: 'Bạn không có đủ Vàng để giao dịch!' };
          }
          playerObj.gold = curGold - gold;
        }

        let escItem = null;
        if (item_type) {
          const deductRes = deductItemFromPlayer(playerObj, {
            item_type,
            item_id,
            item_slot,
            item_tier,
            item_name,
            item_desc,
            item_payload,
            qty
          });
          if (!deductRes.ok) {
            return { ok: false, error: deductRes.error || 'Khấu trừ vật phẩm thất bại!' };
          }

          escItem = {
            item_type,
            item_id: isNaN(parseInt(item_id)) ? item_id : parseInt(item_id),
            item_slot: item_slot || '',
            item_tier: parseInt(item_tier) || 0,
            item_icon: item_icon || '📦',
            item_name: deductRes.name || item_name || 'Vật phẩm',
            item_desc: item_desc || '',
            item_rarity: item_rarity || 'white',
            item_payload: deductRes.payload !== undefined ? deductRes.payload : (item_payload || null),
            q: Math.max(1, parseInt(qty) || 1)
          };
        }

        syncPlayerToDb(dbData, line_uid, playerObj);

        // Cập nhật trạng thái phòng
        me.esc = escItem;
        me.gold = gold;
        me.locked = true;
        me.confirm = false;
        room.u1.confirm = false;
        room.u2.confirm = false;
        room.ver = (room.ver || 1) + 1;
        room.fee = calcTradeFee(room.u1.esc, room.u1.gold, room.u2.esc, room.u2.gold);

        return {
          ok: true,
          player: playerObj
        };
      });

      if (!txRes.ok) return res.json(txRes);

      return res.json({
        ok: true,
        st: 'room',
        room: formatRoomFor(room, line_uid),
        player: txRes.player
      });
    } finally {
      release();
    }
  }

  // 6. Mở khóa đề nghị & Hoàn trả Escrow (unlock)
  if (action === 'unlock') {
    if (!room || room.st !== 'room') {
      return res.json({ ok: false, error: 'Không tìm thấy phòng giao dịch đang hoạt động!' });
    }

    const release = await acquireTwoLocks(room.u1.uid, room.u2.uid);
    try {
      if (room.st !== 'room') {
        return res.json({ ok: false, error: 'Phòng giao dịch đã kết thúc!' });
      }

      const me = room.u1.uid === line_uid ? room.u1 : room.u2;
      if (!me.locked) {
        return res.json({ ok: false, error: 'Đề nghị chưa bị khóa!' });
      }

      const txRes = executeAtomicTransaction((dbData) => {
        const playerRow = (dbData.players || []).find(p => p.line_uid === line_uid);
        if (!playerRow) return { ok: false, error: 'Không tìm thấy người chơi!' };

        let playerObj;
        try { playerObj = JSON.parse(playerRow.raw_data); } catch(e) { return { ok: false, error: 'Dữ liệu người chơi lỗi!' }; }

        if (me.esc) {
          const addRes = addItemToPlayer(playerObj, me.esc, true);
          if (!addRes.ok) return { ok: false, error: addRes.error || 'Hoàn trả vật phẩm thất bại!' };
        }
        if (me.gold > 0) {
          playerObj.gold = (parseInt(playerObj.gold) || 0) + me.gold;
        }

        syncPlayerToDb(dbData, line_uid, playerObj);

        // Reset trạng thái
        me.esc = null;
        me.gold = 0;
        me.locked = false;
        me.confirm = false;
        room.u1.confirm = false;
        room.u2.confirm = false;
        room.ver = (room.ver || 1) + 1;
        room.fee = calcTradeFee(room.u1.esc, room.u1.gold, room.u2.esc, room.u2.gold);

        return {
          ok: true,
          player: playerObj
        };
      });

      if (!txRes.ok) return res.json(txRes);

      return res.json({
        ok: true,
        st: 'room',
        room: formatRoomFor(room, line_uid),
        player: txRes.player
      });
    } finally {
      release();
    }
  }

  // 7. Xác nhận giao dịch (confirm)
  if (action === 'confirm') {
    if (!room || room.st !== 'room') {
      return res.json({ ok: false, error: 'Không tìm thấy phòng giao dịch đang hoạt động!' });
    }

    const release = await acquireTwoLocks(room.u1.uid, room.u2.uid);
    try {
      if (room.st !== 'room') {
        return res.json({ ok: false, error: 'Phòng giao dịch đã kết thúc!' });
      }

      if (!room.u1.locked || !room.u2.locked) {
        return res.json({ ok: false, error: 'Cả hai bên phải cùng khóa đề nghị trước khi xác nhận!' });
      }

      // Chống stale version / race condition
      const clientVer = parseInt(req.body.ver);
      if (clientVer && clientVer !== room.ver) {
        return res.json({
          ok: false,
          error: 'Đề nghị đã bị thay đổi, vui lòng kiểm tra lại và xác nhận lại!',
          room: formatRoomFor(room, line_uid)
        });
      }

      const me = room.u1.uid === line_uid ? room.u1 : room.u2;
      me.confirm = true;

      // Nếu cả hai bên đều đã confirm -> Thực thi Atomic Exchange
      if (room.u1.confirm && room.u2.confirm) {
        const txRes = executeAtomicTransaction((dbData) => {
          const u1Row = (dbData.players || []).find(p => p.line_uid === room.u1.uid);
          const u2Row = (dbData.players || []).find(p => p.line_uid === room.u2.uid);
          if (!u1Row || !u2Row) return { ok: false, error: 'Không tìm thấy thông tin tài khoản!' };

          let p1, p2;
          try {
            p1 = JSON.parse(u1Row.raw_data);
            p2 = JSON.parse(u2Row.raw_data);
          } catch (e) {
            return { ok: false, error: 'Dữ liệu tài khoản bị lỗi!' };
          }

          // Trừ phí P của initiator
          const fee = room.fee || { p: 10 };
          const initiator = room.initiator_uid === room.u1.uid ? p1 : p2;
          const curP = parseInt(initiator.p_points) || 0;
          initiator.p_points = Math.max(0, curP - fee.p);
          initiator.p_spend_total = (parseInt(initiator.p_spend_total) || 0) + fee.p;

          // Trao đổi vật phẩm: u1 nhận đồ của u2, u2 nhận đồ của u1
          if (room.u2.esc) {
            const add1 = addItemToPlayer(p1, room.u2.esc, false);
            if (!add1.ok) return { ok: false, error: add1.error || 'Người chơi 1 không thể nhận vật phẩm!' };
          }
          if (room.u2.gold > 0) {
            p1.gold = (parseInt(p1.gold) || 0) + room.u2.gold;
          }

          if (room.u1.esc) {
            const add2 = addItemToPlayer(p2, room.u1.esc, false);
            if (!add2.ok) return { ok: false, error: add2.error || 'Người chơi 2 không thể nhận vật phẩm!' };
          }
          if (room.u1.gold > 0) {
            p2.gold = (parseInt(p2.gold) || 0) + room.u1.gold;
          }

          syncPlayerToDb(dbData, room.u1.uid, p1);
          syncPlayerToDb(dbData, room.u2.uid, p2);

          // Ghi lịch sử giao dịch hoàn tất
          if (!dbData.trade_history) dbData.trade_history = [];
          const nextId = (dbData.trade_history.length > 0 ? Math.max(...dbData.trade_history.map(x => x.id || 0)) : 0) + 1;
          const nowSec = Math.floor(Date.now() / 1000);

          dbData.trade_history.push({
            id: nextId,
            room_id: room.id,
            status: 'done',
            initiator_uid: room.initiator_uid,
            u1_uid: room.u1.uid,
            u1_name: room.u1.name,
            u2_uid: room.u2.uid,
            u2_name: room.u2.name,
            u1_esc: room.u1.esc,
            u1_gold: room.u1.gold || 0,
            u2_esc: room.u2.esc,
            u2_gold: room.u2.gold || 0,
            fee: fee.p,
            created_at: nowSec
          });

          return {
            ok: true,
            player: line_uid === room.u1.uid ? p1 : p2
          };
        });

        if (!txRes || !txRes.ok) {
          room.u1.confirm = false;
          room.u2.confirm = false;
          return res.json(txRes || { ok: false, error: 'Lỗi thực thi giao dịch!' });
        }

        room.st = 'done';
        userRooms.delete(room.u1.uid);
        userRooms.delete(room.u2.uid);

        return res.json({
          ok: true,
          st: 'ended',
          room: formatRoomFor(room, line_uid),
          player: txRes.player,
          msg: 'Giao dịch thành công!'
        });
      }

      return res.json({
        ok: true,
        st: 'room',
        room: formatRoomFor(room, line_uid)
      });
    } finally {
      release();
    }
  }

  // 8. Hủy giao dịch (cancel)
  if (action === 'cancel') {
    // Nếu đang có pending invite -> hủy invite
    if (userSentInvites.has(line_uid)) {
      const targetUid = userSentInvites.get(line_uid);
      pendingInvites.delete(targetUid);
      userSentInvites.delete(line_uid);
    }
    if (pendingInvites.has(line_uid)) {
      const inv = pendingInvites.get(line_uid);
      userSentInvites.delete(inv.from_uid);
      pendingInvites.delete(line_uid);
    }

    if (room && room.st === 'room') {
      const release = await acquireTwoLocks(room.u1.uid, room.u2.uid);
      try {
        if (room.st !== 'room') {
          return res.json({ ok: true, st: 'idle', room: null });
        }

        let returnPlayer = null;
        const txRes = executeAtomicTransaction((dbData) => {
          // Hoàn trả u1
          if (room.u1.locked) {
            const u1Row = (dbData.players || []).find(p => p.line_uid === room.u1.uid);
            if (u1Row) {
              try {
                const p1 = JSON.parse(u1Row.raw_data);
                if (room.u1.esc) addItemToPlayer(p1, room.u1.esc, true);
                if (room.u1.gold) p1.gold = (p1.gold || 0) + room.u1.gold;
                syncPlayerToDb(dbData, room.u1.uid, p1);
                if (line_uid === room.u1.uid) returnPlayer = p1;
              } catch (e) {
                return { ok: false, error: 'Lỗi hoàn trả player 1' };
              }
            }
          }

          // Hoàn trả u2
          if (room.u2.locked) {
            const u2Row = (dbData.players || []).find(p => p.line_uid === room.u2.uid);
            if (u2Row) {
              try {
                const p2 = JSON.parse(u2Row.raw_data);
                if (room.u2.esc) addItemToPlayer(p2, room.u2.esc, true);
                if (room.u2.gold) p2.gold = (p2.gold || 0) + room.u2.gold;
                syncPlayerToDb(dbData, room.u2.uid, p2);
                if (line_uid === room.u2.uid) returnPlayer = p2;
              } catch (e) {
                return { ok: false, error: 'Lỗi hoàn trả player 2' };
              }
            }
          }

          // Ghi lịch sử hủy
          if (!dbData.trade_history) dbData.trade_history = [];
          const nextId = (dbData.trade_history.length > 0 ? Math.max(...dbData.trade_history.map(x => x.id || 0)) : 0) + 1;
          const nowSec = Math.floor(Date.now() / 1000);

          dbData.trade_history.push({
            id: nextId,
            room_id: room.id,
            status: 'cancel',
            initiator_uid: room.initiator_uid,
            u1_uid: room.u1.uid,
            u1_name: room.u1.name,
            u2_uid: room.u2.uid,
            u2_name: room.u2.name,
            u1_esc: room.u1.esc,
            u1_gold: room.u1.gold || 0,
            u2_esc: room.u2.esc,
            u2_gold: room.u2.gold || 0,
            fee: 0,
            created_at: nowSec
          });

          return { ok: true };
        });

        if (!txRes || !txRes.ok) {
          return res.json({ ok: false, error: (txRes && txRes.error) || 'Lỗi khi hủy giao dịch, vui lòng thử lại!' });
        }

        room.st = 'cancel';
        userRooms.delete(room.u1.uid);
        userRooms.delete(room.u2.uid);

        return res.json({
          ok: true,
          st: 'idle',
          room: null,
          player: returnPlayer || undefined,
          msg: 'Đã hủy giao dịch!'
        });
      } finally {
        release();
      }
    }

    return res.json({ ok: true, st: 'idle', room: null });
  }

  // 9. Lịch sử giao dịch (history)
  if (action === 'history') {
    const historyList = db.data.trade_history || [];
    const rows = [];

    for (const h of historyList) {
      if (h.u1_uid === line_uid || h.u2_uid === line_uid) {
        const isU1 = h.u1_uid === line_uid;
        const partnerName = isU1 ? h.u2_name : h.u1_name;
        const gaveEsc = isU1 ? h.u1_esc : h.u2_esc;
        const gaveGold = isU1 ? (h.u1_gold || 0) : (h.u2_gold || 0);
        const gotEsc = isU1 ? h.u2_esc : h.u1_esc;
        const gotGold = isU1 ? (h.u2_gold || 0) : (h.u1_gold || 0);

        const feePaid = (h.status === 'done' && h.initiator_uid === line_uid) ? (h.fee || 0) : 0;
        const dateStr = new Date((h.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString().replace('T', ' ').substring(0, 19);

        rows.push({
          id: h.id,
          status: h.status,
          partner: partnerName || 'Người chơi',
          when: dateStr,
          gave_item: gaveEsc ? { name: gaveEsc.item_name, icon: gaveEsc.item_icon || '📦', q: gaveEsc.q || 1 } : null,
          gave_gold: gaveGold,
          got_item: gotEsc ? { name: gotEsc.item_name, icon: gotEsc.item_icon || '📦', q: gotEsc.q || 1 } : null,
          got_gold: gotGold,
          fee: feePaid
        });
      }
    }

    rows.sort((a, b) => b.id - a.id);
    return res.json({ ok: true, rows });
  }

  return res.json({ ok: false, error: 'Unknown trade action' });
});

module.exports = router;
