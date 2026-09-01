const db = require('../db/queries');

/**
 * CWarManager - Quản lý Chiến Tranh Quốc Gia / Country Flag War (CWAR) Server-Authoritative
 * 
 * Quy tắc & Contract:
 * - Bản đồ chiến trường: Map 4 (Colosseum / Arena)
 * - State Machine: IDLE -> PRE (21:00) -> OPEN (21:30, 5m, 0 DMG) -> FIGHT (21:35, 15m, PvP Map 4) -> ENDED (21:50) -> IDLE
 * - Sát thương PvP: PVP_DIV = 30
 * - Điểm kill: PPK = 5 điểm (XHRPG_WAR_PT_PER_KILL) cho mục tiêu Lv >= 20 (XHRPG_WAR_PT_MIN_LV)
 * - Quorum: Tối thiểu 2 quốc gia và 4 người tham gia. Nếu không đủ -> cancel: true, giữ nguyên cờ cũ
 * - Tie-break: Quốc gia đạt mốc điểm đó trước (last_score_ts) thắng
 * - Buff Cờ Quốc Gia: EXP x1.1, DROP x1.1 cho toàn bộ người thuộc quốc gia giữ cờ (cwc)
 */
class CWarManager {
  constructor() {
    this.PPK = 5;
    this.MIN_LV = 20;
    this.MAP_ID = 4;
    this.PVP_DIV = 30;
    this.SPAWN_SHIELD_SEC = 5;
    this.MIN_COUNTRIES = 2;
    this.MIN_PARTICIPANTS = 4;

    // Cache trong bộ nhớ đồng bộ với DB
    this.state = {
      st: 'idle', // 'idle' | 'pre' | 'open' | 'fight' | 'ended'
      fight_id: 0,
      started_at: 0,
      open_at: 0,
      fight_at: 0,
      end_at: 0,
      cancel: false,
      seen_end_t: 0
    };

    this.scores = {};       // cc -> { p: number, last_score_ts: number }
    this.participants = {}; // uid -> { line_uid, name, country, lv, joined_at, kills, deaths, home_return }
    this.feed = [];         // [{ id, t, k, kt, v, vt, p }]
    this.processedKills = new Set(); // Chống duplicate kill events

    this.initDb();
  }

  initDb() {
    try {
      db.load();
      if (!db.data) return;

      if (!db.data.cwar_flag) {
        db.data.cwar_flag = {
          holder: 'VN',
          streak: 1,
          won_at: Math.floor(Date.now() / 1000)
        };
      }
      if (!db.data.cwar_history) {
        db.data.cwar_history = [];
      }
      if (!db.data.cwar_feed) {
        db.data.cwar_feed = [];
      } else {
        this.feed = db.data.cwar_feed;
      }
    } catch (e) {
      console.error('Lỗi khởi tạo CWar DB:', e);
    }
  }

  getFlagHoldingCountry() {
    db.load();
    if (db.data && db.data.cwar_flag && db.data.cwar_flag.holder) {
      return db.data.cwar_flag.holder.toUpperCase();
    }
    return 'VN';
  }

  getFlagBuff(playerObj) {
    if (!playerObj) return null;
    const playerCc = String(playerObj.country || playerObj.last_cc || 'VN').toUpperCase();
    const holder = this.getFlagHoldingCountry();

    if (playerCc === holder) {
      return { e: 1.1, d: 1.1 };
    }
    return null;
  }

  /**
   * Cập nhật và kiểm tra tiến trình thời gian thực của Chiến tranh Quốc gia
   */
  tickSchedule() {
    const nowSec = Math.floor(Date.now() / 1000);

    // Nếu đang ở trạng thái OPEN và đã đến giờ FIGHT
    if (this.state.st === 'open' && nowSec >= this.state.fight_at) {
      this.state.st = 'fight';
    }
    // Nếu đang ở trạng thái FIGHT và đã đến giờ END
    else if (this.state.st === 'fight' && nowSec >= this.state.end_at) {
      this.settleWar();
    }
  }

  /**
   * Người chơi tham gia chiến trường Quốc gia (action: 'cwar_join')
   */
  joinWar(playerObj) {
    this.tickSchedule();

    const country = String(playerObj.country || '').toUpperCase().trim();
    if (!country) {
      return {
        ok: false,
        error: 'Cần chọn quốc gia trước khi tham gia Chiến tranh Quốc gia!'
      };
    }

    if (this.state.st !== 'open' && this.state.st !== 'fight') {
      return {
        ok: false,
        error: 'Chiến trường Quốc gia hiện chưa mở cửa!'
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const uid = playerObj.line_uid;

    // Lưu vị trí cũ nếu chưa ở Map 4
    if (playerObj.map !== this.MAP_ID) {
      playerObj.home_return = {
        map: playerObj.map || 1,
        x: playerObj.x || 1125,
        y: playerObj.y || 1125
      };
    }

    // Warp vào Map 4
    playerObj.map = this.MAP_ID;
    playerObj.x = 1125 + Math.floor(Math.random() * 40 - 20);
    playerObj.y = 1125 + Math.floor(Math.random() * 40 - 20);
    playerObj.explore_cx = playerObj.x;
    playerObj.explore_cy = playerObj.y;

    // Kích hoạt khiên hồi sinh 5 giây
    playerObj.col_sh_until = nowSec + this.SPAWN_SHIELD_SEC;

    // Khởi tạo điểm cho quốc gia nếu chưa có
    if (!this.scores[country]) {
      this.scores[country] = { p: 0, last_score_ts: nowSec };
    }

    // Đăng ký người tham gia
    if (!this.participants[uid]) {
      this.participants[uid] = {
        line_uid: uid,
        name: playerObj.name || playerObj.display_name || 'Chiến Binh',
        country: country,
        lv: playerObj.lv || 1,
        joined_at: nowSec,
        kills: 0,
        deaths: 0,
        home_return: playerObj.home_return
      };
    } else {
      this.participants[uid].lv = playerObj.lv || 1;
      this.participants[uid].name = playerObj.name || playerObj.display_name || 'Chiến Binh';
    }

    return {
      ok: true,
      map: this.MAP_ID,
      x: playerObj.x,
      y: playerObj.y
    };
  }

  /**
   * Xử lý hạ gục mục tiêu trong Map 4 (Server-Authoritative Combat)
   */
  recordKill(killerObj, victimObj, killId = null) {
    this.tickSchedule();

    if (this.state.st !== 'fight') {
      return { ok: false, error: 'Chỉ ghi nhận hạ gục trong giai đoạn giao tranh (FIGHT)!' };
    }

    const killerCc = String(killerObj.country || killerObj.last_cc || 'VN').toUpperCase();
    const victimCc = String(victimObj.country || victimObj.last_cc || 'VN').toUpperCase();

    // 1. Chặn Friendly Fire (Cùng quốc gia không được tính kill)
    if (killerCc === victimCc) {
      return { ok: false, error: 'Friendly fire: Không thể tấn công đồng minh cùng quốc gia!' };
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // 2. Idempotency Check
    const uniqueKillId = killId || `kill_${killerObj.line_uid}_${victimObj.line_uid}_${nowSec}_${Math.random().toString(36).substring(2, 6)}`;
    if (this.processedKills.has(uniqueKillId)) {
      return { ok: true, duplicate: true };
    }

    // 3. Chặn Spawn Shield
    if (victimObj.col_sh_until && nowSec < victimObj.col_sh_until) {
      return { ok: false, error: 'Nạn nhân đang có khiên bảo vệ hồi sinh!' };
    }

    this.processedKills.add(uniqueKillId);

    // 4. Tính điểm
    const victimLv = victimObj.lv || 1;
    const points = victimLv >= this.MIN_LV ? this.PPK : 0;

    if (!this.scores[killerCc]) {
      this.scores[killerCc] = { p: 0, last_score_ts: nowSec };
    }

    if (points > 0) {
      this.scores[killerCc].p += points;
      this.scores[killerCc].last_score_ts = nowSec;
    }

    // Cập nhật thống kê cá nhân
    if (this.participants[killerObj.line_uid]) {
      this.participants[killerObj.line_uid].kills += 1;
    }
    if (this.participants[victimObj.line_uid]) {
      this.participants[victimObj.line_uid].deaths += 1;
    }

    // 5. Nạn nhân hồi sinh tại Map 4 spawn point với đầy đủ máu và khiên 5s
    victimObj.hp = victimObj.hp_max || 1000;
    victimObj.x = 1125 + Math.floor(Math.random() * 40 - 20);
    victimObj.y = 1125 + Math.floor(Math.random() * 40 - 20);
    victimObj.explore_cx = victimObj.x;
    victimObj.explore_cy = victimObj.y;
    victimObj.col_sh_until = nowSec + this.SPAWN_SHIELD_SEC;

    // 6. Ghi nhật ký chiến trận (feed)
    const killerName = killerObj.display_name || killerObj.name || 'Chiến Binh';
    const victimName = victimObj.display_name || victimObj.name || 'Chiến Binh';

    const feedEntry = {
      id: uniqueKillId,
      t: nowSec,
      k: killerName,
      kt: killerCc,
      v: victimName,
      vt: victimCc,
      p: points
    };

    this.feed.unshift(feedEntry);
    if (this.feed.length > 50) {
      this.feed = this.feed.slice(0, 50);
    }

    db.load();
    if (db.data) {
      db.data.cwar_feed = this.feed;
      try { db.save(); } catch (e) {}
    }

    return {
      ok: true,
      points,
      feedEntry
    };
  }

  /**
   * Tính toán danh sách xếp hạng các quốc gia
   */
  getRankings() {
    const list = Object.keys(this.scores).map(cc => ({
      g: cc,
      n: cc,
      p: this.scores[cc].p || 0,
      last_score_ts: this.scores[cc].last_score_ts || 0
    }));

    // Tie-break: Sắp xếp theo điểm giảm dần -> Nếu bằng điểm, quốc gia đạt điểm đó trước (last_score_ts nhỏ hơn) thắng
    list.sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      return a.last_score_ts - b.last_score_ts;
    });

    return list;
  }

  /**
   * Tổng kết trận đấu và trao cờ quốc gia (Settlement)
   */
  settleWar() {
    const nowSec = Math.floor(Date.now() / 1000);
    const rankings = this.getRankings();

    // 1. Kiểm tra Quorum: Tối thiểu 2 quốc gia và 4 người tham gia
    const distinctCountries = new Set(Object.values(this.participants).map(p => p.country));
    const totalParticipants = Object.keys(this.participants).length;

    const isQuorumMet = distinctCountries.size >= this.MIN_COUNTRIES && totalParticipants >= this.MIN_PARTICIPANTS;

    db.load();
    if (!db.data.cwar_flag) {
      db.data.cwar_flag = { holder: 'VN', streak: 1, won_at: nowSec };
    }

    let winnerCountry = this.dataHolder || db.data.cwar_flag.holder || 'VN';
    let cancel = false;

    if (isQuorumMet && rankings.length > 0) {
      winnerCountry = rankings[0].g;
      const prevHolder = db.data.cwar_flag.holder;
      const newStreak = (prevHolder === winnerCountry) ? (db.data.cwar_flag.streak || 1) + 1 : 1;

      db.data.cwar_flag = {
        holder: winnerCountry,
        streak: newStreak,
        won_at: nowSec
      };
    } else {
      // Không đủ điều kiện -> Huỷ trận đấu, bảo lưu cờ cũ
      cancel = true;
    }

    // Lưu lịch sử trận đấu
    const historyEntry = {
      fight_id: this.state.fight_id || nowSec,
      winner: cancel ? db.data.cwar_flag.holder : winnerCountry,
      points: (!cancel && rankings.length > 0) ? rankings[0].p : 0,
      streak: db.data.cwar_flag.streak || 1,
      cancel: cancel,
      top: rankings.slice(0, 3),
      total_participants: totalParticipants
    };

    if (!Array.isArray(db.data.cwar_history)) db.data.cwar_history = [];
    db.data.cwar_history.unshift(historyEntry);
    if (db.data.cwar_history.length > 20) {
      db.data.cwar_history = db.data.cwar_history.slice(0, 20);
    }

    // 2. Dọn dẹp & Auto-return toàn bộ người chơi còn trên Map 4 về vị trí ban đầu (home_return)
    this.cleanupAndReturnPlayers();

    // 3. Cập nhật state sang ENDED
    this.state.st = 'ended';
    this.state.cancel = cancel;
    this.state.seen_end_t = nowSec;

    try { db.save(); } catch (e) {}

    return historyEntry;
  }

  /**
   * Tự động hoàn trả toàn bộ người chơi ở Map 4 về vị trí cũ
   */
  cleanupAndReturnPlayers() {
    try {
      db.load();
      if (Array.isArray(db.data.players)) {
        for (const p of db.data.players) {
          try {
            const pObj = JSON.parse(p.raw_data);
            if (pObj.map === this.MAP_ID) {
              const ret = pObj.home_return || { map: 1, x: 1125, y: 1125 };
              pObj.map = ret.map || 1;
              pObj.x = ret.x || 1125;
              pObj.y = ret.y || 1125;
              pObj.explore_cx = pObj.x;
              pObj.explore_cy = pObj.y;
              pObj.last_tick_at = 0;
              delete pObj.home_return;
              delete pObj.col_sh_until;
              p.raw_data = JSON.stringify(pObj);
            }
          } catch (e) {}
        }
        db.save();
      }
    } catch (e) {
      console.error('Lỗi khi cleanupAndReturnPlayers:', e);
    }
  }

  /**
   * Trả về cấu trúc trạng thái `cw` cho Game Poll (/xhrpg_game.php)
   */
  getWarStatus(playerObj) {
    this.tickSchedule();

    const nowSec = Math.floor(Date.now() / 1000);
    const playerCc = String((playerObj && playerObj.country) || (playerObj && playerObj.last_cc) || '').toUpperCase();
    const myGid = playerCc || null;

    if (this.state.st === 'idle') {
      return null;
    }

    if (this.state.st === 'pre') {
      const inSec = Math.max(0, (this.state.open_at || nowSec) - nowSec);
      return {
        st: 'pre',
        in: inSec
      };
    }

    if (this.state.st === 'open' || this.state.st === 'fight') {
      const targetEnd = (this.state.st === 'open') ? this.state.fight_at : this.state.end_at;
      const inSec = Math.max(0, (targetEnd || nowSec) - nowSec);
      const rankings = this.getRankings();
      const myScore = (myGid && this.scores[myGid]) ? (this.scores[myGid].p || 0) : 0;
      const inArena = !!(playerObj && playerObj.map === this.MAP_ID);

      return {
        st: this.state.st,
        in: inSec,
        fight: this.state.fight_id,
        can: !!playerCc,
        in_arena: inArena,
        n: Object.keys(this.participants).length,
        top: rankings.slice(0, 5),
        gid: myGid,
        my: myScore
      };
    }

    if (this.state.st === 'ended') {
      db.load();
      const flagData = (db.data && db.data.cwar_flag) ? db.data.cwar_flag : { holder: 'VN', streak: 1 };
      const rankings = this.getRankings();
      const isMine = !!(playerCc && playerCc === flagData.holder);

      return {
        st: 'ended',
        t: this.state.seen_end_t || nowSec,
        cancel: !!this.state.cancel,
        mine: isMine,
        name: flagData.holder,
        pts: rankings.length > 0 ? rankings[0].p : 0,
        streak: flagData.streak || 1,
        top: rankings.slice(0, 3)
      };
    }

    return null;
  }

  /**
   * Trả về kết quả cho action: 'war_log'
   */
  getWarLog(kind = 'cw') {
    db.load();
    const feed = (db.data && Array.isArray(db.data.cwar_feed)) ? db.data.cwar_feed : this.feed;
    return {
      ok: true,
      feed: feed,
      ppk: this.PPK,
      mlv: this.MIN_LV
    };
  }

  /**
   * Helper điều khiển trạng thái chiến tranh cho Test & Admin
   */
  setWarState(st, inSec = 60, fightId = null) {
    const nowSec = Math.floor(Date.now() / 1000);
    this.state.st = st;
    this.state.fight_id = fightId || (st !== 'idle' ? nowSec : 0);
    this.state.started_at = nowSec;
    this.state.cancel = false;

    if (st === 'pre') {
      this.state.open_at = nowSec + inSec;
      this.state.fight_at = nowSec + inSec + 300;
      this.state.end_at = nowSec + inSec + 1200;
    } else if (st === 'open') {
      this.state.open_at = nowSec;
      this.state.fight_at = nowSec + inSec;
      this.state.end_at = nowSec + inSec + 900;
    } else if (st === 'fight') {
      this.state.open_at = nowSec - 300;
      this.state.fight_at = nowSec;
      this.state.end_at = nowSec + inSec;
    } else if (st === 'ended') {
      this.state.end_at = nowSec;
      this.state.seen_end_t = nowSec;
    }
  }

  /**
   * Reset dữ liệu lượt chiến tranh
   */
  resetWar() {
    this.state = {
      st: 'idle',
      fight_id: 0,
      started_at: 0,
      open_at: 0,
      fight_at: 0,
      end_at: 0,
      cancel: false,
      seen_end_t: 0
    };
    this.scores = {};
    this.participants = {};
    this.processedKills.clear();
  }
}

module.exports = new CWarManager();

