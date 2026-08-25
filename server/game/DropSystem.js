const db = require('../db/queries');

const EMOJI_MAP = {
  wood: '🪵',
  stone: '🪨',
  iron: '⚙️',
  copper: '🟫',
  herb: '🌿'
};

const RESOURCE_NAMES_VI = {
  wood: 'Gỗ',
  stone: 'Đá',
  iron: 'Sắt',
  copper: 'Đồng',
  herb: 'Thảo dược'
};

const MODULE_WEAPONS = [
  'pistol', 'sniper', 'knife', 'axe',
  'robot', 'robot_gun', 'railgun',
  'armor', 'house', 'turret'
];

const MODULE_SLOTS = ['barrel', 'sight'];

const EQ2_STATS = ['spd', 'brg', 'drp', 'rdf', 'ene', 'pam', 'def', 'atk'];

function getDropMultiplier(player) {
  const now = Date.now() / 1000;
  
  // Premium Drop active (+100% drop rate, i.e. +1.0)
  const premiumDropActive = (player.premium_drop_expires || 0) > now;
  const premiumDropBonus = premiumDropActive ? 1.0 : 0.0;
  
  // Premium Boost packs (Newcome: 25, Pack: 25, Pro: 50)
  let premiumBoostBonus = 0.0;
  if ((player.premium_np_expires || 0) > now) premiumBoostBonus += 0.25;
  if ((player.premium_pk_expires || 0) > now) premiumBoostBonus += 0.25;
  if ((player.premium_pro_expires || 0) > now) premiumBoostBonus += 0.50;
  
  // VIP bonus (+5% per VIP level, i.e. 0.05 * vip_lv)
  const vipLv = player.vip_lv || 0;
  const vipBonus = vipLv * 0.05;
  
  // LUK bonus (every 10 LUK = +1% drop rate)
  const luk = player.luk_eff || player.luk || 5;
  const lukBonus = Math.floor(luk / 10) * 0.01;
  
  // Lucky Drop skill bonus (+2% per level)
  let skills = {};
  if (player.skills) {
    try {
      skills = typeof player.skills === 'string' ? JSON.parse(player.skills) : player.skills;
    } catch (e) {
      skills = {};
    }
  }
  const luckyDropLv = skills.lucky_drop || 0;
  const luckyDropBonus = luckyDropLv * 0.02;
  
  return (1.0 + premiumDropBonus + premiumBoostBonus + vipBonus + lukBonus) * (1 + luckyDropBonus);
}

function getResourcesForMap(mapId) {
  const id = parseInt(mapId);
  if (id === 1 || id === 7) return ['wood', 'stone', 'herb'];
  if (id === 2 || id === 8) return ['stone', 'copper'];
  if (id === 3 || id === 9) return ['iron', 'herb'];
  return ['wood', 'stone', 'iron', 'copper', 'herb'];
}

function isMvp(monster) {
  return !!(monster && monster.is_mvp);
}

class DropSystem {
  static generateDrops(player, monster, mapId) {
    const drops = [];
    const events = [];
    const now = Math.floor(Date.now() / 1000);
    const isMonsterMvp = isMvp(monster);
    
    // Khởi tạo drop_log nếu chưa có
    if (!player.drop_log) {
      player.drop_log = [];
    } else if (typeof player.drop_log === 'string') {
      try {
        player.drop_log = JSON.parse(player.drop_log);
      } catch (e) {
        player.drop_log = [];
      }
    }

    const mult = getDropMultiplier(player);

    // --- 1. RỚT NGUYÊN LIỆU THƯỜNG ---
    const luk = player.luk || 5;
    const resChance = Math.min(0.48, 0.20 + (luk - 5) * 0.01);
    
    if (Math.random() < resChance) {
      const allowedRes = getResourcesForMap(mapId);
      const chosenRes = allowedRes[Math.floor(Math.random() * allowedRes.length)];
      let qty = Math.floor(Math.random() * 3) + 1; // Rớt 1 - 3 cái
      
      // Áp dụng kỹ năng gatherer tăng lượng nguyên liệu rơi (+10% mỗi cấp)
      let skills = {};
      if (player.skills) {
        try {
          skills = typeof player.skills === 'string' ? JSON.parse(player.skills) : player.skills;
        } catch (e) {
          skills = {};
        }
      }
      const gathererLv = skills.gatherer || 0;
      qty = Math.round(qty * (1 + gathererLv * 0.10)) || qty;
      
      player[chosenRes] = (player[chosenRes] || 0) + qty;
      const emoji = EMOJI_MAP[chosenRes] || '🌿';
      const nameVi = RESOURCE_NAMES_VI[chosenRes] || chosenRes;
      
      drops.push(emoji);
      events.push({
        type: 'drop',
        msg: `✨ Nhận được ${emoji} ${nameVi} x${qty}`
      });
    }

    // --- 2. RỚT KIM CƯƠNG XANH ---
    const blueBaseChance = 0.00035; // 0.035%
    const blueChance = blueBaseChance * mult;
    if (Math.random() < blueChance) {
      player.diamond_blue = (player.diamond_blue || 0) + 1;
      drops.push('💎');
      events.push({
        type: 'drop',
        msg: `✨ Nhận được 💎 Kim cương xanh`
      });
      player.drop_log.push({ a: 'diamond_drop', n: 'Kim cương xanh', q: 1, ts: now });
    }

    // --- 3. RỚT KIM CƯƠNG ĐỎ (Chỉ quái Lv >= 25) ---
    if (monster.lv >= 25) {
      const redBaseChance = isMonsterMvp ? 0.30 : 0.00014; // MVP: 30%, Thường: 0.014%
      const redChance = redBaseChance * mult;
      if (Math.random() < redChance) {
        player.diamond_red = (player.diamond_red || 0) + 1;
        drops.push('💎');
        events.push({
          type: 'drop',
          msg: `✨ Nhận được 💎 Kim cương đỏ`
        });
        player.drop_log.push({ a: 'diamond_drop', n: 'Kim cương đỏ', q: 1, ts: now });
      }
    }

    // --- 4. RỚT THẺ BÀI (CARD) ---
    const cardBase = isMonsterMvp 
      ? (0.10 - (monster.lv - 1) * (0.10 - 0.020) / 99) 
      : (0.080 - (monster.lv - 1) * (0.080 - 0.004) / 99);
    const cardChance = (cardBase / 100) * mult;
    
    if (Math.random() < cardChance) {
      let cards = {};
      if (player.cards) {
        try {
          cards = typeof player.cards === 'string' ? JSON.parse(player.cards) : player.cards;
        } catch (e) {
          cards = {};
        }
      }
      
      const mid = String(monster.mid);
      if (!cards[mid]) {
        cards[mid] = { n: 0, m: 0 };
      }
      
      if (isMonsterMvp) {
        cards[mid].m = (cards[mid].m || 0) + 1;
      } else {
        cards[mid].n = (cards[mid].n || 0) + 1;
      }
      
      player.cards = JSON.stringify(cards);
      drops.push('🎴');
      events.push({
        type: 'drop',
        msg: `✨ Nhận được 🎴 Thẻ bài ${monster.name}`
      });
      player.drop_log.push({ a: 'card_drop', n: `Thẻ bài ${monster.name}`, q: 1, ts: now });
    }

    // --- 5. RỚT TRỨNG (EGG) ---
    const eggBase = isMonsterMvp 
      ? (0.05 - (monster.lv - 1) * (0.05 - 0.010) / 99) 
      : (0.080 - (monster.lv - 1) * (0.080 - 0.002) / 99);
    const eggChance = (eggBase / 100) * mult;
    
    if (Math.random() < eggChance) {
      let eggs = {};
      if (player.eggs) {
        try {
          eggs = typeof player.eggs === 'string' ? JSON.parse(player.eggs) : player.eggs;
        } catch (e) {
          eggs = {};
        }
      }
      
      const mid = String(monster.mid);
      let eggObj = eggs[mid];
      if (!eggObj || typeof eggObj !== 'object') {
        const oldNum = parseInt(eggObj) || 0;
        eggObj = { n: oldNum, m: 0 };
      }
      
      if (isMonsterMvp) {
        eggObj.m = (eggObj.m || 0) + 1;
      } else {
        eggObj.n = (eggObj.n || 0) + 1;
      }
      
      eggs[mid] = eggObj;
      player.eggs = JSON.stringify(eggs);
      drops.push('🥚');
      events.push({
        type: 'drop',
        msg: `✨ Nhận được 🥚 Trứng ${monster.name}`
      });
      player.drop_log.push({ a: 'egg_drop', n: `Trứng ${monster.name}`, q: 1, ts: now });
    }

    // --- 6. RỚT MÔ-ĐUN (MODULE) ---
    let modBaseChance = 0;
    let modRarity = 1;
    
    // Tìm tier và tỷ lệ theo level quái
    const modConfigList = isMonsterMvp ? [
      [1, 20, 2, 0.625],
      [21, 40, 3, 0.625],
      [41, 60, 4, 0.625],
      [61, 80, 5, 0.313],
      [81, 100, 5, 0.156]
    ] : [
      [1, 20, 1, 0.003],
      [21, 40, 2, 0.003],
      [41, 60, 3, 0.003],
      [61, 80, 4, 0.002],
      [81, 100, 5, 0.001]
    ];
    
    for (const conf of modConfigList) {
      if (monster.lv >= conf[0] && monster.lv <= conf[1]) {
        modRarity = conf[2];
        modBaseChance = conf[3];
        break;
      }
    }
    
    const modChance = (modBaseChance / 100) * mult;
    if (Math.random() < modChance) {
      const weapon = MODULE_WEAPONS[Math.floor(Math.random() * MODULE_WEAPONS.length)];
      const slot = MODULE_SLOTS[Math.floor(Math.random() * MODULE_SLOTS.length)];
      const invField = weapon === 'pistol' ? 'module_inventory' : `${weapon}_module_inventory`;
      
      let inv = [];
      if (player[invField]) {
        try {
          inv = typeof player[invField] === 'string' ? JSON.parse(player[invField]) : player[invField];
        } catch (e) {
          inv = [];
        }
      }
      
      inv.push({
        rarity: modRarity,
        plus: 0,
        slot: slot,
        cards: []
      });
      
      player[invField] = JSON.stringify(inv);
      drops.push('🔧');
      events.push({
        type: 'drop',
        msg: `✨ Nhận được 🔧 Mô-đun ${weapon.toUpperCase()} (T${modRarity})`
      });
      player.drop_log.push({ a: 'module_drop', n: `Mô-đun ${weapon.toUpperCase()} (T${modRarity})`, q: 1, ts: now });
    }

    // --- 7. RỚT TRANG BỊ D2 (EQ2) ---
    let eq2Tier = 0;
    const eq2ConfigList = isMonsterMvp ? [
      [1, 25.0],
      [2, 15.0],
      [3, 10.0],
      [4, 3.75],
      [5, 1.875],
      [6, 0.375]
    ] : [
      [1, 0.080],
      [2, 0.020],
      [3, 0.008],
      [4, 0.003],
      [5, 0.00075]
    ];
    
    for (const conf of eq2ConfigList) {
      const chance = (conf[1] / 100) * mult;
      if (Math.random() < chance) {
        eq2Tier = conf[0];
        // Break để nhận tier cao nhất có thể trong lần roll này (hoặc có thể roll từng cái riêng biệt)
        break;
      }
    }
    
    if (eq2Tier > 0) {
      const slots = ['head', 'body', 'foot', 'ring'];
      const slot = slots[Math.floor(Math.random() * slots.length)];
      
      // Tạo 1-3 affixes tùy tier
      const affixCount = eq2Tier <= 1 ? 1 : (eq2Tier === 2 ? 2 : 3);
      const generatedAffixes = [];
      const usedStats = new Set();
      
      for (let i = 0; i < affixCount; i++) {
        let stat;
        do {
          stat = EQ2_STATS[Math.floor(Math.random() * EQ2_STATS.length)];
        } while (usedStats.has(stat));
        
        usedStats.add(stat);
        // Chỉ số random từ 1 đến tier * 3
        const val = Math.floor(Math.random() * (eq2Tier * 3)) + 1;
        generatedAffixes.push([stat, val]);
      }
      
      let eq2Inv = [];
      if (player.eq2_inv) {
        try {
          eq2Inv = typeof player.eq2_inv === 'string' ? JSON.parse(player.eq2_inv) : player.eq2_inv;
        } catch (e) {
          eq2Inv = [];
        }
      }
      
      const newGear = {
        id: Math.random().toString(36).substring(2, 12),
        s: slot,
        t: eq2Tier,
        lv: 1,
        af: generatedAffixes
      };
      
      eq2Inv.push(newGear);
      player.eq2_inv = JSON.stringify(eq2Inv);
      
      const slotEmojis = { head: '👑', body: '🛡️', foot: '👟', ring: '💍' };
      const gearEmoji = slotEmojis[slot] || '💍';
      
      drops.push(gearEmoji);
      events.push({
        type: 'drop',
        msg: `✨ Nhận được ${gearEmoji} Trang bị ${slot.toUpperCase()} T${eq2Tier}`
      });
      player.drop_log.push({ a: 'mvp_drop', n: `Trang bị ${slot.toUpperCase()} T${eq2Tier}`, q: 1, ts: now });
    }

    // --- 8. HỘP BOX MVP (Chỉ rớt khi diệt MVP) ---
    if (isMonsterMvp) {
      // Hộp mô-đun
      let boxModBase = 6.75;
      if (monster.lv <= 20) boxModBase = 11.25;
      const boxModChance = (boxModBase / 100) * mult;
      
      const boxTier = monster.lv <= 20 ? 1 : (monster.lv <= 40 ? 2 : (monster.lv <= 60 ? 3 : 4));
      
      if (Math.random() < boxModChance) {
        const field = `module_box${boxTier}`;
        player[field] = (player[field] || 0) + 1;
        drops.push('📦');
        events.push({
          type: 'drop',
          msg: `✨ Nhận được 📦 Hộp mô-đun T${boxTier}`
        });
        player.drop_log.push({ a: 'box_drop', n: `Hộp mô-đun T${boxTier}`, q: 1, ts: now });
      }
      
      // Hộp card/egg
      let boxCardBase = 2;
      if (monster.lv <= 20) boxCardBase = 10;
      else if (monster.lv <= 40) boxCardBase = 5;
      const boxCardChance = (boxCardBase / 100) * mult;
      
      if (Math.random() < boxCardChance) {
        const isCard = Math.random() < 0.5;
        const boxType = isCard ? 'card_box' : 'egg_box';
        const field = `${boxType}${boxTier}`;
        
        player[field] = (player[field] || 0) + 1;
        drops.push('📦');
        events.push({
          type: 'drop',
          msg: `✨ Nhận được 📦 Hộp ${isCard ? 'thẻ bài' : 'trứng'} T${boxTier}`
        });
        player.drop_log.push({ a: 'box_drop', n: `Hộp ${isCard ? 'thẻ bài' : 'trứng'} T${boxTier}`, q: 1, ts: now });
      }
    }

    // Giới hạn số lượng drop_log lưu tối đa 100 cái để tránh phình to DB
    if (player.drop_log.length > 100) {
      player.drop_log = player.drop_log.slice(-100);
    }
    
    // Ghi lại drop_log dạng JSON string
    player.drop_log = JSON.stringify(player.drop_log);

    return { drops, events };
  }
}

module.exports = DropSystem;
