const path = require('path');
const fs = require('fs');
const db = require('../db/queries');
const combatEngine = require('./CombatEngine');

const PVP_DIV = 30;

let monMastersCache = {};
try {
  const monMastersPath = path.join(__dirname, '..', '..', 'data', 'mon_masters_cache.json');
  monMastersCache = JSON.parse(fs.readFileSync(monMastersPath, 'utf8'));
} catch (err) {
  console.error('Lỗi đọc mon_masters_cache.json trong RaidManager:', err);
}

const SEED_GROW_H = [1, 2, 4, 8, 16, 24];
const SEED_PRICE = [80, 160, 400, 800, 1920, 3200];
const getSeedTier = id => Math.floor((id - 1) / 4) + 1;
const getSeedGold = id => ((id - 1) & 1) === 1;
const getSeedPrice = id => SEED_PRICE[Math.min(5, Math.max(0, getSeedTier(id) - 1))] * (getSeedGold(id) ? 3 : 1);
const getSeedGrowS = id => SEED_GROW_H[Math.min(5, Math.max(0, getSeedTier(id) - 1))] * 3600;

function getTodayStr() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
}

class RaidManager {
  constructor() {
    this.pendingRaidPops = new Map(); // line_uid -> [popRows]
  }

  // 1. Quota & Reset hàng ngày
  getPlayerQuota(playerObj) {
    if (!playerObj || typeof playerObj !== 'object') {
      playerObj = {};
    }
    const today = getTodayStr();
    if (playerObj.raid_last_reset_day !== today) {
      playerObj.raid_last_reset_day = today;
      playerObj.raid_used_today = 0;
      playerObj.daily_raided_targets = {};
    }
    const vipLv = parseInt(playerObj.vip_lv) || 0;
    const vipBonus = Math.floor((vipLv * (vipLv + 1)) / 2);
    const qMax = 5 + vipBonus;
    const qUsed = parseInt(playerObj.raid_used_today) || 0;
    return { qUsed, qMax, today };
  }

  // 2. Thống kê nhà mục tiêu
  getTargetStats(targetObj, raiderObj) {
    if (!targetObj || typeof targetObj !== 'object') targetObj = {};
    if (!raiderObj || typeof raiderObj !== 'object') raiderObj = {};
    const today = getTodayStr();
    const nowSec = Math.floor(Date.now() / 1000);

    let crops = targetObj.home_crops;
    if (typeof crops === 'string') {
      try { crops = JSON.parse(crops || '[]'); } catch (e) { crops = []; }
    }
    crops = Array.isArray(crops) ? crops : [];

    let ripeCount = 0;
    let growCount = 0;
    let ripeValue = 0;

    crops.forEach(c => {
      const left = getSeedGrowS(c.s) - (nowSec - c.t);
      if (left <= 0) {
        ripeCount++;
        ripeValue += getSeedPrice(c.s) * 2;
      } else {
        growCount++;
      }
    });

    let guards = targetObj.home_guards;
    if (typeof guards === 'string') {
      try { guards = JSON.parse(guards || '[]'); } catch (e) { guards = []; }
    }
    guards = Array.isArray(guards) ? guards : [];

    const isShielded = (parseInt(targetObj.raid_shield_until) || 0) > nowSec;

    const dailyTargets = raiderObj.daily_raided_targets || {};
    const isPaired = dailyTargets[targetObj.line_uid] === today;

    if (targetObj.raided_last_day !== today) {
      targetObj.raided_last_day = today;
      targetObj.raided_count_today = 0;
    }
    const isHitFull = (parseInt(targetObj.raided_count_today) || 0) >= 5;

    const cashGold = parseInt(targetObj.gold) || 0;
    const totalWealth = cashGold + ripeValue;
    let v = 1;
    if (totalWealth > 500000) v = 5;
    else if (totalWealth > 200000) v = 4;
    else if (totalWealth > 80000) v = 3;
    else if (totalWealth > 20000) v = 2;

    return {
      v,
      ready: ripeCount,
      grow: growCount,
      guards: guards.length,
      shield: isShielded,
      paired: isPaired,
      hit_full: isHitFull,
      cashGold,
      ripeValue,
      crops,
      guardsList: guards
    };
  }

  // 3. Lấy danh sách mục tiêu có thể cướp (Action: 'list')
  getTargetsList(raiderUid, raiderObj, page = 0, sort = 'gold') {
    db.load();
    const { qUsed, qMax } = this.getPlayerQuota(raiderObj);
    const pageSize = 25;

    const allPlayers = (db.data.players || []).filter(p => p && p.line_uid && p.line_uid !== raiderUid);

    const targets = allPlayers.map(p => {
      let parsed = {};
      try { parsed = JSON.parse(p.raw_data); } catch (e) { parsed = {}; }
      parsed.line_uid = p.line_uid;
      parsed.name = parsed.name || p.name || 'Chủ nhà';
      parsed.lv = parseInt(parsed.lv) || parseInt(p.lv) || 1;
      parsed.gold = parseInt(parsed.gold) || parseInt(p.gold) || 0;

      const st = this.getTargetStats(parsed, raiderObj);
      return {
        uid: p.line_uid,
        name: parsed.name,
        lv: parsed.lv,
        cc: parsed.country || parsed.last_cc || 'VN',
        v: st.v,
        ready: st.ready,
        grow: st.grow,
        guards: st.guards,
        shield: st.shield,
        paired: st.paired,
        hit_full: st.hit_full,
        _rawGold: parsed.gold,
        _rawCropVal: st.ripeValue
      };
    });

    // Sắp xếp
    if (sort === 'gold') {
      targets.sort((a, b) => b._rawGold - a._rawGold);
    } else if (sort === 'crop') {
      targets.sort((a, b) => b._rawCropVal - a._rawCropVal);
    } else if (sort === 'lv') {
      targets.sort((a, b) => b.lv - a.lv);
    } else if (sort === 'lva') {
      targets.sort((a, b) => a.lv - b.lv);
    }

    const cleanTargets = targets.map(t => {
      const { _rawGold, _rawCropVal, ...rest } = t;
      return rest;
    });

    const totalPages = Math.max(1, Math.ceil(cleanTargets.length / pageSize));
    const validPage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = cleanTargets.slice(validPage * pageSize, (validPage + 1) * pageSize);

    return {
      ok: true,
      q_used: qUsed,
      q_max: qMax,
      page: validPage,
      pages: totalPages,
      sort: sort,
      targets: slice
    };
  }

  // 4. Mô phỏng chiến đấu 2 giai đoạn (Guards + Owner Duel)
  simulateRaidCombat(raiderObj, targetObj) {
    let raiderHp = parseInt(raiderObj.hp_max) || 300;
    const raiderWeapon = raiderObj.active_gun ? (raiderObj.active_gun === 1 ? 'pistol' : 'sniper') : 'knife';

    // Giai đoạn 1: Đánh dàn vệ binh (Guards)
    let guards = targetObj.home_guards;
    if (typeof guards === 'string') {
      try { guards = JSON.parse(guards || '[]'); } catch (e) { guards = []; }
    }
    guards = Array.isArray(guards) ? guards : [];

    for (const g of guards) {
      const mm = monMastersCache[g.id] || { lv: 10, name: 'Vệ binh' };
      const isMvp = (g.mvp | 0) === 1;
      let guardHp = Math.max(50, Math.round(mm.lv * 20 * (isMvp ? 3 : 1)));
      const guardAtk = Math.max(5, Math.round(mm.lv * 2.5 * (isMvp ? 2 : 1)));

      // Trao đổi chiêu thức với vệ binh
      while (guardHp > 0 && raiderHp > 0) {
        const rawRes = combatEngine.calculateDamage(raiderObj, { lv: mm.lv }, raiderWeapon);
        const dmgToGuard = Math.max(1, rawRes.dmg);
        guardHp -= dmgToGuard;

        if (guardHp > 0) {
          const dmgToRaider = Math.max(1, Math.round((guardAtk - (raiderObj.vit || 5) * 0.8)));
          raiderHp -= dmgToRaider;
        }
      }

      if (raiderHp <= 0) {
        return { result: 'lose_guard', raiderWon: false };
      }
    }

    // Giai đoạn 2: Đấu tay đôi với Chủ nhà (Owner Clone Duel)
    let ownerHp = parseInt(targetObj.hp_max) || 300;
    const targetWeapon = targetObj.active_gun ? (targetObj.active_gun === 1 ? 'pistol' : 'sniper') : 'knife';

    let rounds = 0;
    while (raiderHp > 0 && ownerHp > 0 && rounds < 200) {
      rounds++;
      // Raider đánh Chủ nhà
      const rDmgRaw = combatEngine.calculateDamage(raiderObj, targetObj, raiderWeapon);
      const rDmg = Math.max(1, Math.round(rDmgRaw.dmg / PVP_DIV));
      ownerHp -= rDmg;

      if (ownerHp <= 0) break;

      // Chủ nhà đánh Raider
      const oDmgRaw = combatEngine.calculateDamage(targetObj, raiderObj, targetWeapon);
      const oDmg = Math.max(1, Math.round(oDmgRaw.dmg / PVP_DIV));
      raiderHp -= oDmg;
    }

    const raiderMaxHp = parseInt(raiderObj.hp_max) || 300;
    const targetMaxHp = parseInt(targetObj.hp_max) || 300;

    if (ownerHp <= 0 || (rounds >= 200 && (raiderHp / raiderMaxHp) > (ownerHp / targetMaxHp))) {
      return { result: 'win', raiderWon: true };
    } else {
      return { result: 'lose_duel', raiderWon: false };
    }
  }

  // 5. Khởi chạy cuộc đột kích (Action: 'start')
  executeRaid(raiderUid, targetUid, isAuto = false) {
    db.load();
    if (raiderUid === targetUid) {
      return { ok: false, error: 'cannot_raid_self', msg: 'Không thể tự cướp nhà chính mình!' };
    }

    const rRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(raiderUid);
    const tRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(targetUid);
    if (!rRow || !tRow) {
      return { ok: false, error: 'player_not_found', msg: 'Không tìm thấy người chơi!' };
    }

    let raiderObj;
    try { raiderObj = JSON.parse(rRow.raw_data); } catch (e) { raiderObj = {}; }
    raiderObj.line_uid = raiderUid;
    raiderObj.name = raiderObj.name || rRow.name || 'Người cướp';
    raiderObj.lv = parseInt(raiderObj.lv) || parseInt(rRow.lv) || 1;

    let targetObj;
    try { targetObj = JSON.parse(tRow.raw_data); } catch (e) { targetObj = {}; }
    targetObj.line_uid = targetUid;
    targetObj.name = targetObj.name || tRow.name || 'Chủ nhà';
    targetObj.lv = parseInt(targetObj.lv) || parseInt(tRow.lv) || 1;

    const { qUsed, qMax, today } = this.getPlayerQuota(raiderObj);
    if (qUsed >= qMax) {
      return { ok: false, error: 'quota_exceeded', msg: 'Bạn đã hết lượt cướp hôm nay!' };
    }

    const targetStats = this.getTargetStats(targetObj, raiderObj);
    if (targetStats.shield) {
      return { ok: false, error: 'target_shielded', msg: 'Nhà này đang có khiên bảo vệ!' };
    }
    if (targetStats.paired) {
      return { ok: false, error: 'already_raided_today', msg: 'Bạn đã cướp nhà này hôm nay rồi!' };
    }
    if (targetStats.hit_full) {
      return { ok: false, error: 'target_hit_full', msg: 'Nhà này đã bị cướp tối đa số lần hôm nay!' };
    }

    // Tăng quota cướp của người cướp
    raiderObj.raid_used_today = qUsed + 1;
    raiderObj.daily_raided_targets = raiderObj.daily_raided_targets || {};
    raiderObj.daily_raided_targets[targetUid] = today;

    // Tăng số lần bị cướp của chủ nhà
    targetObj.raided_count_today = (parseInt(targetObj.raided_count_today) || 0) + 1;

    // Chạy mô phỏng giao tranh
    const combatRes = this.simulateRaidCombat(raiderObj, targetObj);
    const nowSec = Math.floor(Date.now() / 1000);
    let stolenGold = 0;
    let ownerLost = 0;

    if (combatRes.result === 'win') {
      // Cướp nông sản chín
      let ripeCrops = [];
      let otherCrops = [];
      targetStats.crops.forEach(c => {
        const left = getSeedGrowS(c.s) - (nowSec - c.t);
        if (left <= 0) ripeCrops.push(c);
        else otherCrops.push(c);
      });

      if (ripeCrops.length > 0) {
        const stealCount = Math.max(1, Math.floor(ripeCrops.length * 0.5));
        const stolenCrops = ripeCrops.splice(0, stealCount);
        for (const sc of stolenCrops) {
          const val = getSeedPrice(sc.s) * (Math.floor(Math.random() * 2) + 1);
          stolenGold += val;
        }
        targetObj.home_crops = otherCrops.concat(ripeCrops);
        ownerLost = stolenGold;
      } else {
        // Cướp tiền mặt (tối đa 15% tiền mặt, cap 50k)
        const cash = parseInt(targetObj.gold) || parseInt(tRow.gold) || 0;
        stolenGold = Math.min(50000, Math.floor(cash * 0.15));
        if (stolenGold < 100 && cash >= 100) stolenGold = 100;
        ownerLost = stolenGold;
        targetObj.gold = Math.max(0, cash - stolenGold);
        tRow.gold = targetObj.gold;
      }

      // Cộng vàng cho người cướp
      raiderObj.gold = (parseInt(raiderObj.gold) || parseInt(rRow.gold) || 0) + stolenGold;
      rRow.gold = raiderObj.gold;

      // Cấp khiên 2 giờ cho chủ nhà
      targetObj.raid_shield_until = nowSec + 7200;
    }

    // Ghi bản ghi lịch sử raid_log
    const raidRecord = {
      id: 'raid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      result: combatRes.result,
      raider_uid: raiderUid,
      raider_name: raiderObj.name,
      raider_cc: raiderObj.country || raiderObj.last_cc || 'VN',
      owner_uid: targetUid,
      owner_name: targetObj.name,
      owner_cc: targetObj.country || targetObj.last_cc || 'VN',
      gold: stolenGold,
      owner_lost: ownerLost,
      is_auto: isAuto ? 1 : 0,
      ts: nowSec,
      created_at: nowSec
    };

    db.data.raid_log = db.data.raid_log || [];
    db.data.raid_log.unshift(raidRecord);
    if (db.data.raid_log.length > 100) {
      db.data.raid_log = db.data.raid_log.slice(0, 100);
    }

    // Đẩy notification toast cho cả 2 bên
    this.pushRaidToast(targetUid, { ...raidRecord, mine_side: 'owner' });
    this.pushRaidToast(raiderUid, { ...raidRecord, mine_side: 'raider' });

    // Lưu Database
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(raiderObj), raiderUid
    );
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(targetObj), targetUid
    );
    db.save();

    let msg = '';
    if (combatRes.result === 'win') {
      msg = `Cướp nhà thành công! Thu về ${stolenGold.toLocaleString()} Gold!`;
    } else if (combatRes.result === 'lose_guard') {
      msg = 'Thất bại! Bạn bị dàn vệ binh của chủ nhà đánh gục!';
    } else {
      msg = 'Thất bại! Bạn bị chủ nhà đánh bại trong trận quyết đấu!';
    }

    return {
      ok: true,
      result: combatRes.result,
      gold: stolenGold,
      owner_lost: ownerLost,
      msg: msg
    };
  }

  // 6. Lấy feed cướp toàn server (Action: 'feed')
  getRaidFeed() {
    db.load();
    return (db.data.raid_log || []).slice(0, 20);
  }

  // 7. Lấy lịch sử cướp của người chơi (Action: 'hist')
  getRaidHist(lineUid) {
    db.load();
    const logs = (db.data.raid_log || []).filter(r => r.raider_uid === lineUid || r.owner_uid === lineUid);
    return logs.slice(0, 30);
  }

  // 8. Quản lý Raid Toast Notifications
  pushRaidToast(lineUid, toastRow) {
    if (!this.pendingRaidPops.has(lineUid)) {
      this.pendingRaidPops.set(lineUid, []);
    }
    this.pendingRaidPops.get(lineUid).push(toastRow);
  }

  popRaidNotifications(lineUid) {
    const list = this.pendingRaidPops.get(lineUid) || [];
    this.pendingRaidPops.delete(lineUid);
    return list;
  }
}

module.exports = new RaidManager();

