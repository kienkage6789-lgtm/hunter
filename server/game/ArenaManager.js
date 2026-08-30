const combatEngine = require('./CombatEngine');
const dropSystem = require('./DropSystem');

// Danh sách 8 BOSS Đấu trường mặc định
const ARENA_BOSSES = [
  { mid: 201, name: "Boss Slime Vương", emoji: "🟢", lv: 10, ticket: 1000, pcost: 1, unlock_lv: 10 },
  { mid: 202, name: "Nữ Hoàng Sứa Đỏ", emoji: "🪼", lv: 20, ticket: 2000, pcost: 1, unlock_lv: 20 },
  { mid: 203, name: "Vua Orc Thiết Giáp", emoji: "👹", lv: 30, ticket: 4000, pcost: 2, unlock_lv: 30 },
  { mid: 204, name: "Chúa Tể Ma Cà Rồng", emoji: "🧛", lv: 40, ticket: 8000, pcost: 2, unlock_lv: 40 },
  { mid: 205, name: "Hải Tặc Drake", emoji: "🏴‍☠️", lv: 50, ticket: 15000, pcost: 3, unlock_lv: 50 },
  { mid: 206, name: "Đại Pharaon Osiris", emoji: "🧟", lv: 60, ticket: 30000, pcost: 3, unlock_lv: 60 },
  { mid: 207, name: "Chúa Tể Baphomet", emoji: "🐐", lv: 70, ticket: 50000, pcost: 4, unlock_lv: 70 },
  { mid: 208, name: "Nữ Thần Valkyrie", emoji: "👼", lv: 80, ticket: 80000, pcost: 4, unlock_lv: 80 }
];

function getTodayStr() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().split('T')[0];
}

class ArenaManager {
  constructor() {
    this.bosses = ARENA_BOSSES;
  }

  // 1. Quota & Reset hàng ngày (UTC+7)
  getQuota(playerObj) {
    if (!playerObj || typeof playerObj !== 'object') {
      playerObj = {};
    }
    const today = getTodayStr();
    if (playerObj.arena_last_reset_day !== today) {
      playerObj.arena_last_reset_day = today;
      playerObj.arena_used = 0;
      playerObj.arena_paid = 0;
    }

    const vipLv = parseInt(playerObj.vip_lv) || 0;
    // Free (Gold): 1 + floor(VIP / 3)
    const freeMax = 1 + Math.floor(vipLv / 3);
    // Paid (P): Math.max(1, Math.min(vip, 9) + 2 * Math.max(0, vip - 9))
    const paidMax = Math.max(1, Math.min(vipLv, 9) + 2 * Math.max(0, vipLv - 9));

    const used = parseInt(playerObj.arena_used) || 0;
    const paid = parseInt(playerObj.arena_paid) || 0;

    return { freeMax, used, paidMax, paid, today };
  }

  // 2. Lấy thông tin đấu trường (action: 'info')
  getInfo(playerObj) {
    if (!playerObj || typeof playerObj !== 'object') {
      playerObj = {};
    }
    const { freeMax, used, paidMax, paid } = this.getQuota(playerObj);
    const playerLv = parseInt(playerObj.lv) || 1;

    if (!Array.isArray(playerObj.arena_won)) {
      playerObj.arena_won = [];
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const inArena = !!(playerObj.arena_run && playerObj.arena_run.timeout_at > nowSec && playerObj.arena_run.hp > 0);

    const bosses = [];
    const locked = [];

    for (const b of this.bosses) {
      const won = playerObj.arena_won.includes(b.mid);
      const bossData = {
        mid: b.mid,
        name: b.name,
        emoji: b.emoji,
        lv: b.lv,
        ticket: b.ticket,
        pcost: b.pcost,
        won: won
      };

      if (playerLv >= b.unlock_lv) {
        bosses.push(bossData);
      } else {
        locked.push({
          ...bossData,
          unlock_lv: b.unlock_lv,
          unlock_rag: 0
        });
      }
    }

    return {
      ok: true,
      free_max: freeMax,
      used: used,
      paid_max: paidMax,
      paid: paid,
      in_arena: inArena,
      bosses: bosses,
      locked: locked
    };
  }

  // 3. Khởi tạo phiên đấu Boss (action: 'enter')
  enter(playerObj, mid, pay) {
    if (!playerObj || typeof playerObj !== 'object') {
      return { ok: false, error: 'Dữ liệu nhân vật không hợp lệ!' };
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Kiểm tra nếu đang có boss run hoạt động
    if (playerObj.arena_run && playerObj.arena_run.timeout_at > nowSec && playerObj.arena_run.hp > 0) {
      return { ok: false, error: 'in_arena', msg: 'Bạn đang trong trận thách đấu Boss! Hãy quay lại bản đồ để chiến đấu.' };
    }

    const bossId = parseInt(mid);
    const boss = this.bosses.find(x => x.mid === bossId);
    if (!boss) {
      return { ok: false, error: 'not_found', msg: 'Không tìm thấy BOSS tương ứng!' };
    }

    const playerLv = parseInt(playerObj.lv) || 1;
    if (playerLv < boss.unlock_lv) {
      return { ok: false, error: 'locked', msg: `BOSS này chưa được mở khóa! Cần đạt Lv.${boss.unlock_lv}.` };
    }

    const { freeMax, used, paidMax, paid } = this.getQuota(playerObj);

    // Kiểm tra & trừ chi phí 1 lần duy nhất (one-time charge)
    if (pay === 'g') {
      if (used >= freeMax) {
        return { ok: false, error: 'quota_full', msg: 'Bạn đã sử dụng hết lượt khiêu chiến miễn phí (G) hôm nay!' };
      }
      const playerGold = parseInt(playerObj.gold) || 0;
      if (playerGold < boss.ticket) {
        return { ok: false, error: 'not_enough_gold', msg: `Không đủ Vàng để tham gia! Cần ${boss.ticket.toLocaleString()} Gold.` };
      }
      playerObj.gold = playerGold - boss.ticket;
      playerObj.arena_used = used + 1;
    } else if (pay === 'p') {
      if (paid >= paidMax) {
        return { ok: false, error: 'quota_full', msg: 'Bạn đã sử dụng hết lượt khiêu chiến trả phí (P) hôm nay!' };
      }
      const playerPts = parseInt(playerObj.p_points) || 0;
      if (playerPts < boss.pcost) {
        return { ok: false, error: 'not_enough_p', msg: `Không đủ điểm Premium (P) để tham gia! Cần ${boss.pcost} P.` };
      }
      playerObj.p_points = playerPts - boss.pcost;
      playerObj.arena_paid = paid + 1;
    } else {
      return { ok: false, error: 'invalid_pay', msg: 'Phương thức thanh toán không hợp lệ (g hoặc p)!' };
    }

    // Khởi tạo active boss run với HP chuẩn và timeout 60 giây
    const bossHpMax = Math.max(200, Math.round(boss.lv * 40));
    playerObj.arena_run = {
      mid: boss.mid,
      name: boss.name,
      emoji: boss.emoji,
      lv: boss.lv,
      hp: bossHpMax,
      hp_max: bossHpMax,
      started_at: nowSec,
      timeout_at: nowSec + 60,
      pay: pay
    };

    return {
      ok: true,
      msg: `⚔️ Đã bắt đầu thách đấu BOSS ${boss.name} (Lv.${boss.lv})! Hãy tấn công Boss trong 60 giây.`
    };
  }

  // 4. Càn quét nhanh Boss đã thắng (action: 'skip')
  skip(playerObj, mid, pay, count = 1) {
    if (!playerObj || typeof playerObj !== 'object') {
      return { ok: false, error: 'Dữ liệu nhân vật không hợp lệ!' };
    }

    const bossId = parseInt(mid);
    const boss = this.bosses.find(x => x.mid === bossId);
    if (!boss) {
      return { ok: false, error: 'not_found', msg: 'Không tìm thấy BOSS tương ứng!' };
    }

    const playerLv = parseInt(playerObj.lv) || 1;
    if (playerLv < boss.unlock_lv) {
      return { ok: false, error: 'locked', msg: `BOSS này chưa được mở khóa! Cần đạt Lv.${boss.unlock_lv}.` };
    }

    if (!Array.isArray(playerObj.arena_won) || !playerObj.arena_won.includes(bossId)) {
      return { ok: false, error: 'not_won', msg: 'Bạn phải thắng BOSS này ít nhất một lần để sử dụng Càn quét!' };
    }

    const { freeMax, used, paidMax, paid } = this.getQuota(playerObj);

    let repeat = Math.max(1, Math.min(5, parseInt(count) || 1));

    if (pay === 'g') {
      const gLeft = Math.max(0, freeMax - used);
      if (gLeft <= 0) {
        return { ok: false, error: 'quota_full', msg: 'Bạn đã sử dụng hết lượt khiêu chiến miễn phí (G) hôm nay!' };
      }
      repeat = Math.min(repeat, gLeft);
      const totalCost = boss.ticket * repeat;
      const playerGold = parseInt(playerObj.gold) || 0;
      if (playerGold < totalCost) {
        return { ok: false, error: 'not_enough_gold', msg: `Không đủ Vàng để càn quét ${repeat} lần! Cần ${totalCost.toLocaleString()} Gold.` };
      }
      playerObj.gold = playerGold - totalCost;
      playerObj.arena_used = used + repeat;
    } else if (pay === 'p') {
      const pLeft = Math.max(0, paidMax - paid);
      if (pLeft <= 0) {
        return { ok: false, error: 'quota_full', msg: 'Bạn đã sử dụng hết lượt khiêu chiến trả phí (P) hôm nay!' };
      }
      repeat = Math.min(repeat, pLeft);
      const totalCost = boss.pcost * repeat;
      const playerPts = parseInt(playerObj.p_points) || 0;
      if (playerPts < totalCost) {
        return { ok: false, error: 'not_enough_p', msg: `Không đủ điểm Premium (P) để càn quét ${repeat} lần! Cần ${totalCost} P.` };
      }
      playerObj.p_points = playerPts - totalCost;
      playerObj.arena_paid = paid + repeat;
    } else {
      return { ok: false, error: 'invalid_pay', msg: 'Phương thức thanh toán không hợp lệ (g hoặc p)!' };
    }

    // Trao thưởng EXP & Gold
    const expReward = boss.lv * 150 * repeat;
    const goldReward = boss.lv * 300 * repeat;
    playerObj.exp = (parseInt(playerObj.exp) || 0) + expReward;
    playerObj.gold = (parseInt(playerObj.gold) || 0) + goldReward;

    // Sinh drops cho mỗi lần càn quét
    const allDrops = [];
    for (let r = 0; r < repeat; r++) {
      const runDrops = this._generateBossDrops(playerObj, boss);
      allDrops.push(...runDrops);
    }

    // Lưu vào lịch sử nhận thưởng của Boss
    this._recordHist(playerObj, bossId, allDrops);

    return {
      ok: true,
      msg: `⏩ Càn quét ${repeat} lần BOSS ${boss.name} thành công! Nhận được ${expReward.toLocaleString()} EXP và ${goldReward.toLocaleString()} Gold.`,
      drops: allDrops,
      runs: repeat
    };
  }

  // 5. Lấy lịch sử nhận thưởng của Boss (action: 'hist')
  getHist(playerObj, mid) {
    if (!playerObj || typeof playerObj !== 'object') {
      return { ok: true, hist: [] };
    }
    const bossId = parseInt(mid);
    if (!playerObj.arena_hist || typeof playerObj.arena_hist !== 'object') {
      return { ok: true, hist: [] };
    }
    const list = Array.isArray(playerObj.arena_hist[bossId]) ? playerObj.arena_hist[bossId] : [];
    return { ok: true, hist: list.slice(0, 15) };
  }

  // 6. Tick giao tranh Boss thời gian thực trong Game Poll
  tickCombat(playerObj, activeWeapon = 'knife') {
    if (!playerObj || typeof playerObj !== 'object' || !playerObj.arena_run) {
      return null;
    }

    const run = playerObj.arena_run;
    const nowSec = Math.floor(Date.now() / 1000);
    const events = [];

    // Kiểm tra hết giờ (TIMEOUT: 60s)
    if (nowSec >= run.timeout_at) {
      playerObj.arena_run = null;
      events.push({
        type: 'arena_fail',
        msg: `⏳ Hết thời gian thách đấu BOSS ${run.name} (60 giây)! Không nhận được phần thưởng.`
      });
      return { state: 'TIMEOUT', events };
    }

    // Kiểm tra người chơi đã hết máu trước khi đánh (LOSE)
    let playerHp = parseInt(playerObj.hp);
    const playerHpMax = parseInt(playerObj.hp_max) || 300;
    if (isNaN(playerHp) || playerHp <= 0) {
      playerObj.arena_run = null;
      playerObj.hp = playerHpMax;
      events.push({
        type: 'arena_fail',
        msg: `💀 Bạn đã bị BOSS ${run.name} hạ gục! Không nhận được phần thưởng.`
      });
      return { state: 'LOSE', events };
    }

    // --- Bước 1: Người chơi tấn công Boss (Server-Authoritative Damage) ---
    const weapon = activeWeapon || (playerObj.active_gun === 1 ? 'pistol' : (playerObj.active_gun === 2 ? 'sniper' : 'knife'));
    const dmgRaw = combatEngine.calculateDamage(playerObj, { lv: run.lv, is_mvp: true }, weapon);
    const dmgToBoss = Math.max(1, Math.round(dmgRaw.dmg));
    run.hp = Math.max(0, run.hp - dmgToBoss);

    events.push({
      type: 'hit',
      msg: `⚔️ Đánh trúng ${run.name} -${dmgToBoss} HP`,
      mid: run.mid,
      dmg: dmgToBoss,
      boss_hp: run.hp,
      boss_hp_max: run.hp_max
    });

    // --- Bước 2: Kiểm tra Boss bị tiêu diệt (WIN) ---
    if (run.hp <= 0) {
      playerObj.arena_run = null;

      // Mở khóa arena_won
      if (!Array.isArray(playerObj.arena_won)) {
        playerObj.arena_won = [];
      }
      if (!playerObj.arena_won.includes(run.mid)) {
        playerObj.arena_won.push(run.mid);
      }

      // Trao thưởng EXP & Gold 1 lần duy nhất
      const expReward = run.lv * 150;
      const goldReward = run.lv * 300;
      playerObj.exp = (parseInt(playerObj.exp) || 0) + expReward;
      playerObj.gold = (parseInt(playerObj.gold) || 0) + goldReward;

      // Sinh drops
      const bossData = this.bosses.find(b => b.mid === run.mid) || { mid: run.mid, name: run.name, lv: run.lv };
      const drops = this._generateBossDrops(playerObj, bossData);

      // Lưu lịch sử
      this._recordHist(playerObj, run.mid, drops);

      events.push({
        type: 'arena_reward',
        name: run.name,
        drops: drops,
        runs: 1
      });

      events.push({
        type: 'kill',
        is_mvp: true,
        name: run.name,
        msg: `🏆 Bạn đã tiêu diệt BOSS ${run.name}! Nhận +${expReward.toLocaleString()} EXP và +${goldReward.toLocaleString()} Gold.`
      });

      return {
        state: 'WIN',
        events,
        drops,
        exp: expReward,
        gold: goldReward
      };
    }

    // --- Bước 3: Boss phản công người chơi ---
    const bossAtk = Math.max(10, Math.round(run.lv * 3.5));
    const playerVit = parseInt(playerObj.vit) || 5;
    const dmgToPlayer = Math.max(1, Math.round(bossAtk - playerVit * 0.8));
    playerObj.hp = Math.max(0, playerHp - dmgToPlayer);

    events.push({
      type: 'pvp_hit',
      dmg: dmgToPlayer
    });

    // --- Bước 4: Kiểm tra người chơi bị hạ gục (LOSE) ---
    if (playerObj.hp <= 0) {
      playerObj.arena_run = null;
      playerObj.hp = playerHpMax; // Hồi sinh
      playerObj.map = 1;
      playerObj.x = 1125;
      playerObj.y = 1125;

      events.push({
        type: 'arena_fail',
        msg: `💀 Bạn đã bị BOSS ${run.name} đánh bại! Hãy nâng cấp trang bị và thử lại.`
      });

      return { state: 'LOSE', events };
    }

    return { state: 'ACTIVE', events };
  }

  // Helper sinh drops Boss
  _generateBossDrops(playerObj, boss) {
    const drops = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const mult = dropSystem.getDropMultiplier(playerObj);

    // 1. Kim cương đỏ (35%)
    if (Math.random() < Math.min(1, 0.35 * mult)) {
      playerObj.diamond_red = (parseInt(playerObj.diamond_red) || 0) + 1;
      drops.push('💎 Kim cương đỏ');
      if (!Array.isArray(playerObj.drop_log)) playerObj.drop_log = [];
      playerObj.drop_log.push({ a: 'diamond_drop', n: 'Kim cương đỏ', q: 1, ts: nowSec });
    }

    // 2. Thẻ bài Boss (12%)
    if (Math.random() < Math.min(1, 0.12 * mult)) {
      let cards = {};
      try { cards = typeof playerObj.cards === 'string' ? JSON.parse(playerObj.cards) : (playerObj.cards || {}); } catch(e) {}
      const midStr = String(boss.mid);
      if (!cards[midStr]) cards[midStr] = { n: 0, m: 0 };
      cards[midStr].m = (cards[midStr].m || 0) + 1;
      playerObj.cards = JSON.stringify(cards);
      drops.push(`🎴 Thẻ bài ${boss.name}`);
      if (!Array.isArray(playerObj.drop_log)) playerObj.drop_log = [];
      playerObj.drop_log.push({ a: 'card_drop', n: `Thẻ bài ${boss.name}`, q: 1, ts: nowSec });
    }

    // 3. Trứng Boss (10%)
    if (Math.random() < Math.min(1, 0.10 * mult)) {
      let eggs = {};
      try { eggs = typeof playerObj.eggs === 'string' ? JSON.parse(playerObj.eggs) : (playerObj.eggs || {}); } catch(e) {}
      const midStr = String(boss.mid);
      if (!eggs[midStr] || typeof eggs[midStr] !== 'object') eggs[midStr] = { n: 0, m: 0 };
      eggs[midStr].m = (eggs[midStr].m || 0) + 1;
      playerObj.eggs = JSON.stringify(eggs);
      drops.push(`🥚 Trứng ${boss.name}`);
      if (!Array.isArray(playerObj.drop_log)) playerObj.drop_log = [];
      playerObj.drop_log.push({ a: 'egg_drop', n: `Trứng ${boss.name}`, q: 1, ts: nowSec });
    }

    // 4. Hộp Mô-đun (Tier 3-5 theo cấp Boss) (25%)
    if (Math.random() < Math.min(1, 0.25 * mult)) {
      const tier = Math.min(5, Math.max(2, Math.floor(boss.lv / 20) + 1));
      drops.push(`📦 Hộp Mô-đun (Tier ${tier})`);
    }

    return drops;
  }

  // Helper ghi lịch sử
  _recordHist(playerObj, mid, drops) {
    if (!playerObj.arena_hist || typeof playerObj.arena_hist !== 'object') {
      playerObj.arena_hist = {};
    }
    const bossId = parseInt(mid);
    if (!Array.isArray(playerObj.arena_hist[bossId])) {
      playerObj.arena_hist[bossId] = [];
    }
    playerObj.arena_hist[bossId].unshift({
      t: Math.floor(Date.now() / 1000),
      d: drops || []
    });
    if (playerObj.arena_hist[bossId].length > 15) {
      playerObj.arena_hist[bossId] = playerObj.arena_hist[bossId].slice(0, 15);
    }
  }
}

module.exports = new ArenaManager();

