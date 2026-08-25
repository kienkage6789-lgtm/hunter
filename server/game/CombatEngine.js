class CombatEngine {
  // Tính sát thương cơ bản dựa trên stats và skills của player
  calculateDamage(player, monster) {
    let skills = {};
    try {
      skills = typeof player.skills === 'string' ? JSON.parse(player.skills || '{}') : (player.skills || {});
    } catch (e) {
      skills = {};
    }

    // Lấy cấp độ các kỹ năng chiến đấu
    const knifeAtkLv = skills.knife_atk || 0;
    const critShotLv = skills.crit_shot || 0;
    const doubleAtkLv = skills.double_attack || 0;

    const str = player.str || 5;
    const dex = player.dex || 5;
    const luk = player.luk || 5;
    const lv = player.lv || 1;

    // 1. Tính ATK cơ bản
    let baseAtk = 10;
    if (knifeAtkLv > 0) {
      // Công thức nâng cấp dao găm theo game gốc: (STR - 5) * 3 + 10 + (Lv - 1) * 8
      baseAtk = (str - 5) * 3 + 10 + (knifeAtkLv - 1) * 8;
    } else {
      baseAtk = str * 2 + dex + lv;
    }

    // 2. Thêm bonus sát thương từ chỉ số DEX vượt mức cơ bản
    const dexBonus = Math.max(0, dex - 5) * 2;
    baseAtk += dexBonus;

    // 3. Kỹ năng crit_shot (chí mạng) cộng thêm sát thương phẳng
    if (critShotLv > 0) {
      baseAtk += critShotLv * 15;
    }

    // 4. Tính toán bạo kích (Critical hit)
    // Mỗi 10 điểm LUK + STR tăng 1% tỷ lệ chí mạng, tối đa 50% từ stat
    const critChanceFromStats = Math.min(0.50, Math.floor((luk + str) / 10) / 100);
    // Kỹ năng crit_shot cộng thêm 2% tỷ lệ chí mạng mỗi cấp
    const critChanceFromSkill = critShotLv * 0.02;
    const totalCritChance = critChanceFromStats + critChanceFromSkill;
    const isCrit = Math.random() < totalCritChance;

    let multiplier = 1;
    if (isCrit) {
      multiplier *= 2;
    }

    // 5. Kỹ năng song kích (double_attack) có cơ hội nhân đôi sát thương (fallback passive)
    if (doubleAtkLv > 0 && !isCrit) {
      const procChance = 0.05 + doubleAtkLv * 0.05; // Tối đa 30% cơ hội ở cấp 5
      if (Math.random() < procChance) {
        multiplier *= 2;
      }
    }

    // 6. Tính phòng thủ của quái vật
    const def = monster.lv * 1.5;

    let dmg = (baseAtk - def) * multiplier;
    if (dmg < 1) dmg = 1; // Sát thương tối thiểu là 1

    // 7. Thêm random variance (±10%)
    const variance = 0.9 + Math.random() * 0.2;
    const finalDmg = Math.round(dmg * variance);

    return {
      dmg: finalDmg,
      crit: isCrit ? 1 : 0
    };
  }
}

module.exports = new CombatEngine();
