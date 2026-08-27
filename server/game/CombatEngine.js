class CombatEngine {
  // Tính sát thương cơ bản dựa trên stats và skills của player
  calculateDamage(player, monster, activeWeapon = 'knife', effStats = {}, eq2FxSum = () => 0) {
    let skills = {};
    try {
      skills = typeof player.skills === 'string' ? JSON.parse(player.skills || '{}') : (player.skills || {});
    } catch (e) {
      skills = {};
    }

    const str = effStats.str ?? player.str ?? 5;
    const dex = effStats.dex ?? player.dex ?? 5;
    const agi = effStats.agi ?? player.agi ?? 5;
    const luk = effStats.luk ?? player.luk ?? 5;
    const lv = player.lv || 1;

    let baseAtk = 10;

    // Tính lượng ATK phẳng từ mô-đun
    let modTotalAtk = 0;
    try {
      const railOn = (parseInt(player.robot_railgun_expires) || 0) > Math.floor(Date.now() / 1000);
      function safeParse(val, fallback) {
        if (!val) return fallback;
        if (typeof val === 'object') return val;
        try { return JSON.parse(val) || fallback; } catch (e) { return fallback; }
      }
      function getPlayerModules(p, w) {
        return safeParse(p[w + '_modules'], {});
      }
      function getModEnhAtk(plus) {
        const p = Math.max(0, Math.min(15, parseInt(plus) || 0));
        const b = p <= 5 ? p * (p + 1) / 2 : (p <= 10 ? 15 + 5 * (p - 5) : 40 + 10 * (p - 10));
        return b * 2;
      }
      function getModBarrelAtk(m) {
        if (!m) return 0;
        return (Math.max(1, parseInt(m.rarity) || 1) - 1) * 3 + getModEnhAtk(parseInt(m.plus) || 0);
      }
      function getModGunAtk(mods) {
        return getModBarrelAtk(mods.barrel) + getModBarrelAtk(mods.mag);
      }
      function getModSightAtk(mods) {
        return getModBarrelAtk(mods.sight);
      }

      ['pistol', 'sniper', 'knife', 'axe', 'robot_gun', 'railgun'].forEach(w => {
        if (w === 'railgun' && !railOn) return;
        const m = getPlayerModules(player, w);
        modTotalAtk += getModGunAtk(m) + getModSightAtk(m);
      });
      const tm = getPlayerModules(player, 'turret');
      modTotalAtk += getModBarrelAtk(tm.t_atk) + getModBarrelAtk(tm.t_range) + getModBarrelAtk(tm.t_dur);
    } catch (err) {
      console.error("Lỗi tính modTotalAtk trong CombatEngine:", err);
    }

    const eq2AtkBonus = eq2FxSum('atk');

    if (activeWeapon === 'knife') {
      const knifeLv = player.knife_lv || 1;
      const knifeAtkLv = skills.knife_atk || 0;
      const swpOption = eq2FxSum('swp');
      
      baseAtk = 10 + (str - 5) * 3 + (knifeLv - 1) * 8 + knifeAtkLv * 6;
      baseAtk = Math.round(baseAtk * (1 + 0.005 * knifeAtkLv + swpOption / 10000));
    } 
    else if (activeWeapon === 'pistol') {
      const plv = player.gun_pistol_lv || 1;
      const critShotLv = skills.crit_shot || 0;
      const thpOption = eq2FxSum('thp');
      
      baseAtk = 20 + Math.max(0, dex - 5) * 2 + critShotLv * 10 + (plv - 1) * 2;
      baseAtk = Math.round(baseAtk * (1 + 0.02 * critShotLv + thpOption / 10000));
    } 
    else if (activeWeapon === 'sniper') {
      const slv = player.gun_sniper_lv || 1;
      const critShotLv = skills.crit_shot || 0;
      const thpOption = eq2FxSum('thp');
      
      baseAtk = Math.round(120 + Math.max(0, dex - 5) * 2.5) + critShotLv * 10 + (slv - 1) * 5;
      baseAtk = Math.round(baseAtk * (1 + 0.02 * critShotLv + thpOption / 10000));
    }

    // Cộng thêm sát thương phẳng
    baseAtk += modTotalAtk + eq2AtkBonus;

    // Áp dụng bội số sát thương (nhân đôi sát thương của kỹ năng / song kích)
    let multiplier = 1;
    if (activeWeapon === 'knife') {
      // Song kích đao pháp Auto (knife_atk): 1%/Cấp + 1% mỗi 30 AGI (tối đa 50%)
      const knifeAtkLv = skills.knife_atk || 0;
      const doubleAtkChance = Math.min(0.50, 0.01 * knifeAtkLv + agi / 3000);
      if (Math.random() < doubleAtkChance) {
        multiplier *= 2;
      }
    }

    // Tính tỷ lệ chí mạng chuẩn theo công thức game gốc
    let crit = 0;
    const critChance = (Math.min(50, Math.floor((str + luk) / 10)) + (player.rag_crit || 0) * 0.1) / 100;
    if (Math.random() < critChance) {
      crit = 1;
      multiplier *= 2;
    }

    // Giảm trừ phòng thủ của quái
    const def = monster.lv * 1.5;

    let dmg = (baseAtk - def) * multiplier;
    if (dmg < 1) dmg = 1;

    // Biên độ sát thương ngẫu nhiên (+- 10%)
    const variance = 0.9 + Math.random() * 0.2;
    return {
      dmg: Math.round(dmg * variance),
      crit: crit
    };
  }
}

module.exports = new CombatEngine();
