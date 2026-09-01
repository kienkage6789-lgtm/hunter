const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');
const worldManager = require('../game/WorldManager');

const router = express.Router();

// Middleware xác thực ADMIN_API_KEY và Admin Role/Session qua HTTP Headers
router.use((req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY || (process.env.NODE_ENV === 'test' ? 'test_admin_secret_key' : null);

  if (!adminKey) {
    return res.status(403).json({ ok: false, error: 'Admin API is disabled (missing ADMIN_API_KEY)' });
  }

  // Chặn tuyệt đối và từ chối nếu truyền key qua query params hoặc request body (ngăn ngừa rò rỉ secret trong logs/URL)
  if ((req.query && (req.query.admin_api_key || req.query.key)) || (req.body && (req.body.admin_api_key || req.body.key))) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: admin_api_key via query or body is prohibited. Use x-admin-api-key or Authorization header.' });
  }

  // 1. Xác thực API Key từ Headers
  let token = null;
  const rawHeader = req.headers['x-admin-api-key'] || req.headers['authorization'];
  if (typeof rawHeader === 'string') {
    if (rawHeader.startsWith('Bearer ')) {
      token = rawHeader.slice(7).trim();
    } else {
      token = rawHeader.trim();
    }
  }

  if (!token || token !== adminKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing or invalid ADMIN_API_KEY' });
  }

  // 2. Xác thực Admin Role & Session Token nếu có thông tin Operator UID / Session Token
  const adminUid = req.headers['x-admin-uid'] || (req.body && req.body.admin_uid);
  const adminSessionToken = req.headers['x-admin-session-token'] || (req.body && req.body.admin_session_token);

  if (adminUid || adminSessionToken) {
    db.load();
    if (!db.data || !Array.isArray(db.data.users)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Database not ready' });
    }

    const adminUser = db.data.users.find(u => u.line_uid === adminUid);
    if (!adminUser) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin user not found' });
    }

    // Kiểm tra quyền role === 'admin'
    if (adminUser.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden: User does not have admin role' });
    }

    // Kiểm tra session_token nếu có
    if (adminSessionToken && adminUser.session_token !== adminSessionToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid admin session token' });
    }

    req.adminUser = adminUser;
  }

  next();
});

// Helper lưu nhật ký thao tác GM Admin
function recordAdminLog(action, targetUid, payload, result, req) {
  db.load();
  if (!db.data) return;
  if (!Array.isArray(db.data.admin_logs)) {
    db.data.admin_logs = [];
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const createdAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const logEntry = {
    id: `alog_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 8)}`,
    action: action,
    operator_uid: req.adminUser ? req.adminUser.line_uid : 'system',
    ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
    target_uid: targetUid || null,
    payload: payload || {},
    result: result || {},
    created_at: createdAt
  };

  db.data.admin_logs.unshift(logEntry);
  if (db.data.admin_logs.length > 100) {
    db.data.admin_logs.pop();
  }
  db.save();
}

// Helper quản lý Idempotency
function checkIdempotency(reqId) {
  if (!reqId) return null;
  try {
    db.load();
    if (db.data && db.data.admin_idempotency && db.data.admin_idempotency[reqId]) {
      const item = db.data.admin_idempotency[reqId];
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - item.ts < 300) { // 5 phút TTL
        return item.response;
      }
    }
  } catch (e) {}
  return null;
}

function saveIdempotency(reqId, response) {
  if (!reqId) return;
  db.load();
  if (!db.data) return;
  if (!db.data.admin_idempotency) {
    db.data.admin_idempotency = {};
  }
  const nowSec = Math.floor(Date.now() / 1000);
  db.data.admin_idempotency[reqId] = {
    ts: nowSec,
    response: response
  };

  // Prune entries > 10 phút
  for (let k in db.data.admin_idempotency) {
    if (nowSec - db.data.admin_idempotency[k].ts > 600) {
      delete db.data.admin_idempotency[k];
    }
  }
  db.save();
}

const MODULE_INV_FIELDS = {
  pistol: 'module_inventory',
  sniper: 'sniper_module_inventory',
  knife: 'knife_module_inventory',
  axe: 'axe_module_inventory',
  robot: 'robot_module_inventory',
  robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory',
  armor: 'armor_module_inventory',
  house: 'house_module_inventory',
  turret: 'turret_module_inventory',
  '': 'module_inventory'
};

const VALID_RESOURCES = ['wood', 'stone', 'iron', 'copper', 'herb', 'diamond_blue', 'diamond_red', 'gold', 'p_points'];
const VALID_BOX_TYPES = ['module_box1', 'module_box2', 'module_box3', 'module_box4', 'card_box1', 'card_box2', 'card_box3', 'card_box4', 'egg_box1', 'egg_box2', 'egg_box3', 'egg_box4', 'vip_box1', 'vip_box2', 'vip_box3'];

// =============================================================================
// 1. API GIVE ITEM (POST /give_item & POST /give-item)
// =============================================================================
const handleGiveItem = async (req, res) => {
  const { line_uid, item_type, item_id, quantity, options, req_id } = req.body;

  if (!line_uid || !item_type) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc item_type' });
  }

  const qty = parseInt(quantity !== undefined ? quantity : 1);
  if (isNaN(qty) || qty <= 0) {
    return res.json({ ok: false, error: 'Quantity phải là số nguyên dương lớn hơn 0' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    // 1. Kiểm tra Idempotency bên trong Lock để chống race condition
    const cachedRes = checkIdempotency(req_id);
    if (cachedRes) {
      return res.json(cachedRes);
    }

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    const opt = options || {};
    let successMsg = '';

    // Xử lý từng phân loại item_type
    if (item_type === 'resource' || item_type === 'currency') {
      const resName = String(item_id || opt.resource_name || '').toLowerCase();
      if (!VALID_RESOURCES.includes(resName)) {
        return res.json({ ok: false, error: `Tài nguyên không hợp lệ: ${resName}. Hỗ trợ: ${VALID_RESOURCES.join(', ')}` });
      }

      if (qty > 999999) {
        return res.json({ ok: false, error: 'Số lượng tài nguyên tối đa là 999,999' });
      }

      playerObj[resName] = (playerObj[resName] || 0) + qty;
      successMsg = `Đã cấp ${qty} ${resName} cho người chơi.`;
    } else if (item_type === 'box') {
      const boxType = String(item_id || opt.box_type || '').toLowerCase();
      if (!VALID_BOX_TYPES.includes(boxType)) {
        return res.json({ ok: false, error: `Loại hộp không hợp lệ: ${boxType}. Hỗ trợ: ${VALID_BOX_TYPES.join(', ')}` });
      }

      if (qty > 9999) {
        return res.json({ ok: false, error: 'Số lượng hộp tối đa là 9,999' });
      }

      playerObj[boxType] = (playerObj[boxType] || 0) + qty;
      successMsg = `Đã cấp ${qty} ${boxType} cho người chơi.`;
    } else if (item_type === 'card' || item_type === 'egg') {
      const mid = parseInt(item_id || opt.mid);
      if (isNaN(mid) || mid < 1 || mid > 999) {
        return res.json({ ok: false, error: 'mid quái vật không hợp lệ (1 - 999)' });
      }

      const variant = (opt.variant === 'm' || opt.is_mvp) ? 'm' : 'n';
      const targetField = item_type === 'card' ? 'cards' : 'eggs';

      let coll = {};
      if (playerObj[targetField]) {
        try {
          coll = typeof playerObj[targetField] === 'string' ? JSON.parse(playerObj[targetField]) : playerObj[targetField];
        } catch (e) {
          coll = {};
        }
      }

      const sMid = String(mid);
      let entry = coll[sMid];
      if (!entry || typeof entry !== 'object') {
        const oldVal = parseInt(entry) || 0;
        entry = { n: oldVal, m: 0 };
      }

      entry[variant] = (entry[variant] || 0) + qty;
      coll[sMid] = entry;
      playerObj[targetField] = JSON.stringify(coll);
      successMsg = `Đã cấp ${qty} ${item_type} #${mid} (${variant === 'm' ? 'MVP' : 'Thường'}) cho người chơi.`;
    } else if (item_type === 'module') {
      const weapon = String(item_id || opt.weapon || 'pistol').toLowerCase();
      const invField = MODULE_INV_FIELDS[weapon];
      if (!invField) {
        return res.json({ ok: false, error: `Loại vũ khí mô-đun không hợp lệ: ${weapon}` });
      }

      let inv = [];
      if (playerObj[invField]) {
        try {
          inv = typeof playerObj[invField] === 'string' ? JSON.parse(playerObj[invField]) : playerObj[invField];
        } catch (e) {
          inv = [];
        }
      }

      // Giới hạn 30 slot kho mô-đun
      if (inv.length + qty > 30) {
        return res.json({ ok: false, error: `Túi đồ mô-đun ${weapon} đã đầy (tối đa 30 slot, hiện có ${inv.length} món)` });
      }

      const rarity = Math.max(1, Math.min(5, parseInt(opt.rarity) || 1));
      const slot = String(opt.slot || 'barrel').toLowerCase();
      const plus = Math.max(0, Math.min(10, parseInt(opt.plus) || 0));
      const cards = Array.isArray(opt.cards) ? opt.cards : [];

      for (let i = 0; i < qty; i++) {
        inv.push({
          id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          rarity: rarity,
          plus: plus,
          slot: slot,
          cards: cards
        });
      }

      playerObj[invField] = JSON.stringify(inv);
      successMsg = `Đã cấp ${qty} mô-đun ${weapon.toUpperCase()} (T${rarity} +${plus}) cho người chơi.`;
    } else if (item_type === 'eq2') {
      let eq2Inv = [];
      if (playerObj.eq2_inv) {
        try {
          eq2Inv = typeof playerObj.eq2_inv === 'string' ? JSON.parse(playerObj.eq2_inv) : playerObj.eq2_inv;
        } catch (e) {
          eq2Inv = [];
        }
      }

      if (eq2Inv.length + qty > 50) {
        return res.json({ ok: false, error: `Túi đồ trang bị EQ2 đã đầy (tối đa 50 slot, hiện có ${eq2Inv.length} món)` });
      }

      const slots = ['head', 'body', 'foot', 'ring'];
      const slot = String(item_id || opt.slot || 'head').toLowerCase();
      if (!slots.includes(slot)) {
        return res.json({ ok: false, error: `Slot trang bị EQ2 không hợp lệ: ${slot}. Hỗ trợ: ${slots.join(', ')}` });
      }

      const tier = Math.max(1, Math.min(6, parseInt(opt.tier) || 1));
      const level = Math.max(1, Math.min(99, parseInt(opt.level) || 1));
      const affixes = Array.isArray(opt.affixes) ? opt.affixes : [['atk', tier * 5]];

      for (let i = 0; i < qty; i++) {
        eq2Inv.push({
          id: `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          s: slot,
          t: tier,
          lv: level,
          af: affixes
        });
      }

      playerObj.eq2_inv = JSON.stringify(eq2Inv);
      successMsg = `Đã cấp ${qty} trang bị EQ2 ${slot.toUpperCase()} (T${tier}) cho người chơi.`;
    } else {
      return res.json({ ok: false, error: `item_type không xác định: ${item_type}. Hỗ trợ: resource, currency, box, card, egg, module, eq2` });
    }

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const responsePayload = {
      ok: true,
      msg: successMsg,
      player: playerObj
    };

    saveIdempotency(req_id, responsePayload);
    recordAdminLog('give_item', line_uid, req.body, responsePayload, req);

    return res.json(responsePayload);
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cấp vật phẩm:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống khi cấp vật phẩm' });
  } finally {
    release();
  }
};

router.post('/give_item', handleGiveItem);
router.post('/give-item', handleGiveItem);

// =============================================================================
// 2. API SPAWN BOSS (POST /spawn_boss & POST /spawn-boss)
// =============================================================================
const handleSpawnBoss = async (req, res) => {
  const { map_id, mid, name, lv, hp, x, y, emoji, req_id } = req.body;

  if (map_id === undefined || map_id === null) {
    return res.json({ ok: false, error: 'Thiếu map_id' });
  }

  const mapNum = parseInt(map_id);
  if (isNaN(mapNum) || mapNum < 1 || mapNum > 13) {
    return res.json({ ok: false, error: 'Bản đồ không hợp lệ (hỗ trợ Map 1 - 13)' });
  }

  const release = await acquireLock(`admin_spawn_map_${mapNum}`);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));
  let spawnedBossId = null;

  try {
    // 1. Kiểm tra Idempotency bên trong Lock để chống race condition
    const cachedRes = checkIdempotency(req_id);
    if (cachedRes) {
      return res.json(cachedRes);
    }

    const spawnResult = worldManager.spawnCustomBoss(mapNum, {
      mid,
      name,
      lv,
      hp,
      x,
      y,
      emoji
    });

    if (!spawnResult.ok) {
      return res.json(spawnResult);
    }

    spawnedBossId = spawnResult.boss.id;

    const responsePayload = {
      ok: true,
      msg: `Đã triệu hồi Boss ${spawnResult.boss.name} (Lv.${spawnResult.boss.lv}) tại Map ${spawnResult.boss.map} (${spawnResult.boss.x}, ${spawnResult.boss.y})!`,
      boss: spawnResult.boss
    };

    saveIdempotency(req_id, responsePayload);
    recordAdminLog('spawn_boss', null, req.body, responsePayload, req);

    return res.json(responsePayload);
  } catch (err) {
    // Rollback DB snapshot và xóa quái vừa sinh khỏi WorldManager memory nếu có lỗi
    db.data = snapshot;
    try { db.save(); } catch (e) {}

    if (spawnedBossId && worldManager.maps[mapNum] && Array.isArray(worldManager.maps[mapNum].monsters)) {
      worldManager.maps[mapNum].monsters = worldManager.maps[mapNum].monsters.filter(m => m.id !== spawnedBossId);
    }

    console.error('Lỗi triệu hồi Boss:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống khi triệu hồi Boss' });
  } finally {
    release();
  }
};

router.post('/spawn_boss', handleSpawnBoss);
router.post('/spawn-boss', handleSpawnBoss);

// =============================================================================
// 3. API GIVE P POINT (POST /give_p & POST /give-p)
// =============================================================================
const handleGiveP = async (req, res) => {
  const { line_uid, amount, req_id } = req.body;

  if (!line_uid || amount === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc amount' });
  }

  const pAmount = parseInt(amount);
  if (isNaN(pAmount)) {
    return res.json({ ok: false, error: 'Amount phải là số' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const cachedRes = checkIdempotency(req_id);
    if (cachedRes) return res.json(cachedRes);

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.p_points = (playerObj.p_points || 0) + pAmount;
    if (pAmount > 0) {
      playerObj.p_total = (playerObj.p_total || 0) + pAmount;
    }

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const responsePayload = { ok: true, msg: `Cấp thành công ${pAmount} P. Số dư hiện tại: ${playerObj.p_points} P.`, player: playerObj };
    saveIdempotency(req_id, responsePayload);
    recordAdminLog('give_p', line_uid, req.body, responsePayload, req);

    return res.json(responsePayload);
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cấp P Point:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
};

router.post('/give_p', handleGiveP);
router.post('/give-p', handleGiveP);

// =============================================================================
// 4. API GIVE GOLD (POST /give_gold & POST /give-gold)
// =============================================================================
const handleGiveGold = async (req, res) => {
  const { line_uid, amount, req_id } = req.body;

  if (!line_uid || amount === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc amount' });
  }

  const gAmount = parseInt(amount);
  if (isNaN(gAmount)) {
    return res.json({ ok: false, error: 'Amount phải là số' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const cachedRes = checkIdempotency(req_id);
    if (cachedRes) return res.json(cachedRes);

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.gold = (playerObj.gold || 0) + gAmount;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const responsePayload = { ok: true, msg: `Cấp thành công ${gAmount} Gold. Số dư hiện tại: ${playerObj.gold} Gold.`, player: playerObj };
    saveIdempotency(req_id, responsePayload);
    recordAdminLog('give_gold', line_uid, req.body, responsePayload, req);

    return res.json(responsePayload);
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cấp Gold:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
};

router.post('/give_gold', handleGiveGold);
router.post('/give-gold', handleGiveGold);

// =============================================================================
// 5. API SET LEVEL (POST /set_level & POST /set-level)
// =============================================================================
const handleSetLevel = async (req, res) => {
  const { line_uid, level, req_id } = req.body;

  if (!line_uid || level === undefined) {
    return res.json({ ok: false, error: 'Thiếu line_uid hoặc level' });
  }

  const lv = parseInt(level);
  if (isNaN(lv) || lv < 1) {
    return res.json({ ok: false, error: 'Level không hợp lệ' });
  }

  const release = await acquireLock(line_uid);
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));

  try {
    const cachedRes = checkIdempotency(req_id);
    if (cachedRes) return res.json(cachedRes);

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Không tìm thấy người chơi' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    playerObj.lv = lv;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const responsePayload = { ok: true, msg: `Đã cập nhật cấp độ lên Lv.${lv}.`, player: playerObj };
    saveIdempotency(req_id, responsePayload);
    recordAdminLog('set_level', line_uid, req.body, responsePayload, req);

    return res.json(responsePayload);
  } catch (err) {
    db.data = snapshot;
    try { db.save(); } catch (e) {}
    console.error('Lỗi cập nhật level:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi hệ thống' });
  } finally {
    release();
  }
};

router.post('/set_level', handleSetLevel);
router.post('/set-level', handleSetLevel);

module.exports = router;
