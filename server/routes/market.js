const express = require('express');
const db = require('../db/queries');

const router = express.Router();

const MOD_INV_FIELDS = {
  pistol: 'module_inventory', sniper: 'sniper_module_inventory', knife: 'knife_module_inventory',
  axe: 'axe_module_inventory', robot: 'robot_module_inventory', robot_gun: 'robot_gun_module_inventory',
  railgun: 'railgun_module_inventory', armor: 'armor_module_inventory', house: 'house_module_inventory',
  turret: 'turret_module_inventory'
};

// Seed dữ liệu chợ mặc định nếu trống
function seedMarketListings() {
  if (!db.data.market_listings) {
    db.data.market_listings = [];
  }
  if (db.data.market_listings.length === 0) {
    db.data.market_listings.push(
      { id: 101, item_name: "Thẻ Gà con (1⭐)", item_type: "card", item_id: 1, price_per: 500, qty: 1, seller_uid: "npc" },
      { id: 102, item_name: "Thẻ Heo con (1⭐)", item_type: "card", item_id: 2, price_per: 800, qty: 1, seller_uid: "npc" },
      { id: 103, item_name: "Trứng Slime xanh (1⭐)", item_type: "egg", item_id: 19, price_per: 1200, qty: 1, seller_uid: "npc" },
      { id: 104, item_name: "Module Súng T1", item_type: "module", item_id: 1, price_per: 1500, qty: 1, seller_uid: "npc" },
      { id: 105, item_name: "Module Dao T3", item_type: "module", item_id: 3, price_per: 2500, qty: 1, seller_uid: "npc" }
    );
    db.save();
  }
}

router.post('/', async (req, res) => {
  const { line_uid, action, listing_id, qty } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  const { acquireLock } = require('../utils/lock');
  const release = await acquireLock(line_uid);

  try {
    db.load();
    seedMarketListings();

    const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
    if (!pRow) {
      return res.json({ ok: false, error: 'Player not found' });
    }

    let playerObj;
    try {
      playerObj = JSON.parse(pRow.raw_data);
    } catch (e) {
      playerObj = {};
    }

    // 1. Lấy danh sách hàng bán trên chợ
    if (action === 'get_listings') {
      const list = db.data.market_listings || [];
      return res.json({
        ok: true,
        listings: list.filter(item => item.qty > 0)
      });
    }

    // 2. Mua hàng
    if (action === 'buy') {
      const targetId = parseInt(listing_id);
      const listings = db.data.market_listings || [];
      const itemIdx = listings.findIndex(x => x.id === targetId);

      if (itemIdx === -1 || listings[itemIdx].qty <= 0) {
        return res.json({ ok: false, error: "Vật phẩm đã được bán hoặc không tồn tại!" });
      }

      const item = listings[itemIdx];
      const buyQty = parseInt(qty) || 1;

      if (item.qty < buyQty) {
        return res.json({ ok: false, error: "Số lượng trên chợ không đủ!" });
      }

      const totalCost = item.price_per * buyQty;
      const playerGold = playerObj.gold || 0;

      if (playerGold < totalCost) {
        return res.json({ ok: false, error: "Bạn không đủ Vàng để mua!" });
      }

      // Trừ tiền người mua
      playerObj.gold = playerGold - totalCost;

      // Cộng vật phẩm vào hòm đồ của người mua
      // Cộng vật phẩm vào hòm đồ của người mua
      if (item.item_type === 'card') {
        let cards = playerObj.cards;
        if (typeof cards === 'string') { try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; } }
        cards = cards || {};
        const cardObj = cards[item.item_id] || { n: 0, m: 0 };
        const isMvp = item.item_slot === 'mvp';
        if (isMvp) cardObj.m = (cardObj.m || 0) + buyQty;
        else cardObj.n = (cardObj.n || 0) + buyQty;
        cards[item.item_id] = cardObj;
        playerObj.cards = JSON.stringify(cards);
      } else if (item.item_type === 'egg') {
        let eggs = playerObj.eggs;
        if (typeof eggs === 'string') { try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; } }
        eggs = eggs || {};
        const eggObj = eggs[item.item_id] || { n: 0, m: 0 };
        const isMvp = item.item_slot === 'mvp';
        if (isMvp) eggObj.m = (eggObj.m || 0) + buyQty;
        else eggObj.n = (eggObj.n || 0) + buyQty;
        eggs[item.item_id] = eggObj;
        playerObj.eggs = JSON.stringify(eggs);
      } else if (item.item_type.startsWith('module_') && item.item_type !== 'module_box') {
        const weapon = item.item_type.replace('module_', '');
        const invField = MOD_INV_FIELDS[weapon];
        if (invField) {
          let inv = playerObj[invField];
          if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
          inv = inv || [];
          if (inv.length >= 30) {
            return res.json({ ok: false, error: "Hòm đồ của bạn đã đầy (tối đa 30), không thể mua thêm module!" });
          }
          let moduleObj = null;
          try {
            moduleObj = typeof item.item_payload === 'string' ? JSON.parse(item.item_payload) : item.item_payload;
          } catch(e) {}
          if (moduleObj) {
            inv.push(moduleObj);
            playerObj[invField] = (typeof playerObj[invField] === 'string') ? JSON.stringify(inv) : inv;
          } else {
            return res.json({ ok: false, error: "Dữ liệu module không hợp lệ!" });
          }
        }
      } else if (item.item_type === 'module' || item.item_type === 'module_box' || item.item_type === 'card_box' || item.item_type === 'egg_box') {
        const actualType = (item.item_type === 'module') ? 'module_box' : item.item_type;
        const tier = parseInt(item.item_tier) || parseInt(item.item_id) || 1;
        const boxField = `${actualType}${tier}`;
        playerObj[boxField] = (parseInt(playerObj[boxField]) || 0) + buyQty;
      }

      // Trả tiền cho người bán (nếu không phải là NPC)
      if (item.seller_uid !== 'npc') {
        const sellerRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(item.seller_uid);
        if (sellerRow) {
          try {
            const sellerObj = JSON.parse(sellerRow.raw_data);
            sellerObj.gold = (sellerObj.gold || 0) + totalCost;
            db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
              JSON.stringify(sellerObj), item.seller_uid
            );
          } catch (err) {
            console.error("Lỗi cộng vàng cho người bán:", err);
          }
        }
      }

      // Cập nhật số lượng trên chợ
      item.qty -= buyQty;
      if (item.qty <= 0) {
        listings.splice(itemIdx, 1);
      }

      db.data.market_listings = listings;
      db.save();

      // Cập nhật DB người mua
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );

      return res.json({
        ok: true,
        player: playerObj,
        msg: `Mua thành công ${buyQty}x ${item.item_name}!`
      });
    }

    // 3. Đăng bán vật phẩm (action: sell)
    if (action === 'sell') {
      const { item_type, item_id, qty: sellQtyRaw, price_per: priceRaw, item_slot, item_name, item_payload, item_tier } = req.body;
      const sellQty = parseInt(sellQtyRaw) || 1;
      const price = parseInt(priceRaw) || 1;

      let hasItem = false;
      let name = item_name || "Vật phẩm";

      // Kiểm tra hòm đồ người bán
      if (item_type === 'card') {
        let cards = playerObj.cards;
        if (typeof cards === 'string') { try { cards = JSON.parse(cards || '{}'); } catch(e) { cards = {}; } }
        cards = cards || {};
        const cardObj = cards[item_id] || { n: 0, m: 0 };
        const isMvp = item_slot === 'mvp';
        const available = isMvp ? cardObj.m : cardObj.n;
        if (available >= sellQty) {
          if (isMvp) cardObj.m -= sellQty;
          else cardObj.n -= sellQty;
          cards[item_id] = cardObj;
          playerObj.cards = JSON.stringify(cards);
          hasItem = true;
          name = item_name || `Thẻ bài #${item_id}${isMvp ? ' ⭐MVP' : ''}`;
        }
      } else if (item_type === 'egg') {
        let eggs = playerObj.eggs;
        if (typeof eggs === 'string') { try { eggs = JSON.parse(eggs || '{}'); } catch(e) { eggs = {}; } }
        eggs = eggs || {};
        const eggObj = eggs[item_id] || { n: 0, m: 0 };
        const isMvp = item_slot === 'mvp';
        const available = isMvp ? eggObj.m : eggObj.n;
        if (available >= sellQty) {
          if (isMvp) eggObj.m -= sellQty;
          else eggObj.n -= sellQty;
          eggs[item_id] = eggObj;
          playerObj.eggs = JSON.stringify(eggs);
          hasItem = true;
          name = item_name || `Trứng thú #${item_id}${isMvp ? ' ⭐MVP' : ''}`;
        }
      } else if (item_type.startsWith('module_') && item_type !== 'module_box') {
        const weapon = item_type.replace('module_', '');
        const invField = MOD_INV_FIELDS[weapon];
        if (invField) {
          let inv = playerObj[invField];
          if (typeof inv === 'string') { try { inv = JSON.parse(inv || '[]'); } catch(e) { inv = []; } }
          inv = inv || [];
          const idx = parseInt(item_id);
          if (idx >= 0 && idx < inv.length) {
            const m = inv[idx];
            if (m && m.slot === item_slot) {
              inv.splice(idx, 1);
              playerObj[invField] = (typeof playerObj[invField] === 'string') ? JSON.stringify(inv) : inv;
              hasItem = true;
              name = item_name || `Module T${m.t} (${m.slot})`;
            }
          }
        }
      } else if (item_type === 'module' || item_type === 'module_box' || item_type === 'card_box' || item_type === 'egg_box') {
        const actualType = (item_type === 'module') ? 'module_box' : item_type;
        const tier = parseInt(item_tier) || parseInt(item_id) || 1;
        const boxField = `${actualType}${tier}`;
        const available = parseInt(playerObj[boxField]) || 0;
        if (available >= sellQty) {
          playerObj[boxField] = available - sellQty;
          hasItem = true;
          const boxLabel = actualType === 'module_box' ? 'Module' : (actualType === 'card_box' ? 'Thẻ bài' : 'Trứng');
          name = item_name || `Hộp ${boxLabel} T${tier}`;
        }
      }

      if (!hasItem) {
        return res.json({ ok: false, error: "Bạn không có đủ vật phẩm trong hòm đồ để bán!" });
      }

      // Tạo listing mới trên chợ
      const listings = db.data.market_listings || [];
      const nextId = listings.length > 0 ? Math.max(...listings.map(x => x.id)) + 1 : 1000;

      listings.push({
        id: nextId,
        item_name: name,
        item_type: item_type,
        item_id: parseInt(item_id),
        item_slot: item_slot || 'normal',
        item_tier: parseInt(item_tier) || 0,
        item_payload: item_payload || null,
        price_per: price,
        qty: sellQty,
        seller_uid: line_uid
      });

      db.data.market_listings = listings;
      db.save();

      // Cập nhật hòm đồ DB người bán
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
        JSON.stringify(playerObj), line_uid
      );

      return res.json({
        ok: true,
        player: playerObj,
        msg: `Đã đăng bán ${sellQty}x ${name} với giá ${price} Gold/cái lên chợ!`
      });
    }

    res.json({ ok: false, error: 'Unknown action' });
  } finally {
    release();
  }
});

module.exports = router;
