const db = require('../db/queries');

/**
 * GWarManager - Quản lý Chiến Tranh Bang Hội / Guild Flag War (GWAR) Server-Authoritative
 * 
 * Quy tắc & Contract:
 * - Bản đồ chiến trường: Map 4 (Colosseum / Arena)
 * - State Machine: IDLE -> PRE (21:00) -> OPEN (21:30, 5m, 0 DMG) -> FIGHT (21:35, 15m, PvP Map 4) -> ENDED (21:50) -> IDLE
 * - Sát thương PvP: PVP_DIV = 30
 * - Điểm kill: PPK = 1 điểm cho mục tiêu Lv >= 40 (MIN_LV = 40)
 * - Chống farm lặp (Anti-Abuse): Tối đa 3 điểm / nạn nhân / trận chiến (MAX_POINTS_PER_VICTIM = 3)
 * - Cooldown gia nhập bang: Cần ở trong bang đủ 48 giờ (JOIN_COOLDOWN_HOURS = 48) để tham gia
 * - Chặn Friendly-Fire: Cùng bang hoặc cùng liên minh (Alliance) bị chặn hoàn toàn
 * - Quorum: Tối thiểu 2 bang hội và 4 người tham gia. Nếu không đủ -> cancel: true, giữ nguyên cờ cũ
 * - Tie-break: Bang đạt mốc điểm đó trước (last_score_ts) thắng
 * - Buff Cờ Bang Hội: EXP x1.1, GOLD x1.1 (gwf) cho bang giữ cờ và các bang đồng minh
 * - Persistence & Restart Recovery: Tự động lưu và khôi phục trạng thái runtime (state, scores, participants, victimKills, processedKills)
 */
class GWarManager {
  constructor() {
    this.PPK = 1;
    this.MIN_LV = 40;
    this.MAX_POINTS_PER_VICTIM = 3;
    this.JOIN_COOLDOWN_HOURS = 48;
    this.MAP_ID = 4;
    this.PVP_DIV = 30;
    this.SPAWN_SHIELD_SEC = 5;
    this.MIN_GUILDS = 2;
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

    this.scores = {};       // gid -> { p: number, last_score_ts: number, name: string }
    this.participants = {}; // uid -> { line_uid, name, guild_id, guild_name, lv, joined_at, kills, deaths, home_return, col_sh_until }
    this.feed = [];         // [{ id, t, k, kt, v, vt, p }]
    this.victimKills = {};  // 'gid_victimUid' -> count of awarded points
    this.processedKills = new Set(); // Chống duplicate kill events

    this.initDb();
  }

  initDb() {
    try {
      db.load();
      if (!db.data) return;

      if (!db.data.gwar_flag) {
        db.data.gwar_flag = {
          holder_id: 1,
          holder_name: 'Ragnalok',
          streak: 1,
          won_at: Math.floor(Date.now() / 1000)
        };
      }
      if (!db.data.gwar_history) {
        db.data.gwar_history = [];
      }
      if (!db.data.gwar_feed) {
        db.data.gwar_feed = [];
      } else {
        this.feed = db.data.gwar_feed;
      }

      // Khôi phục trạng thái runtime sau khi Server Restart
      if (db.data.gwar_runtime) {
        if (db.data.gwar_runtime.state) {
          this.state = Object.assign(this.state, db.data.gwar_runtime.state);
        }
        if (db.data.gwar_runtime.scores) {
          this.scores = db.data.gwar_runtime.scores;
        }
        if (db.data.gwar_runtime.participants) {
          this.participants = db.data.gwar_runtime.participants;
        }
        if (db.data.gwar_runtime.victimKills) {
          this.victimKills = db.data.gwar_runtime.victimKills;
        }
        if (Array.isArray(db.data.gwar_runtime.processedKills)) {
          this.processedKills = new Set(db.data.gwar_runtime.processedKills);
        }
      }

      this.tickSchedule();
    } catch (e) {
      console.error('Lỗi khởi tạo GWar DB:', e);
    }
  }

  saveRuntime() {
    try {
      db.load();
      if (!db.data) return;
      db.data.gwar_runtime = {
        state: this.state,
        scores: this.scores,
        participants: this.participants,
        victimKills: this.victimKills,
        processedKills: Array.from(this.processedKills)
      };
      db.save();
    } catch (e) {
      console.error('Lỗi lưu gwar_runtime:', e);
    }
  }

  getFlagHoldingGuildId() {
    db.load();
    if (db.data && db.data.gwar_flag && db.data.gwar_flag.holder_id) {
      return Number(db.data.gwar_flag.holder_id);
    }
    return 1;
  }

  getFlagHoldingGuildName() {
    db.load();
    if (db.data && db.data.gwar_flag && db.data.gwar_flag.holder_name) {
      return db.data.gwar_flag.holder_name;
    }
    return 'Ragnalok';
  }

  /**
   * Kiểm tra hai bang có phải là đồng minh trong cùng liên minh không
   */
  isAllied(gid1, gid2) {
    if (!gid1 || !gid2 || gid1 === gid2) return false;
    db.load();
    if (!db.data || !Array.isArray(db.data.alliances)) return false;

    const nGid1 = Number(gid1);
    const nGid2 = Number(gid2);

    return db.data.alliances.some(a => {
      const mems = (a.members || []).map(Number);
      return mems.includes(nGid1) && mems.includes(nGid2);
    });
  }

  /**
   * Lấy danh sách ID các bang đồng minh của một bang
   */
  getAlliedGuildIds(gid) {
    if (!gid) return [];
    db.load();
    if (!db.data || !Array.isArray(db.data.alliances)) return [];

    const nGid = Number(gid);
    const allies = new Set();
    db.data.alliances.forEach(a => {
      const mems = (a.members || []).map(Number);
      if (mems.includes(nGid)) {
        mems.forEach(id => {
          if (id !== nGid) allies.add(id);
        });
      }
    });

    return Array.from(allies);
  }

  /**
   * Lấy Buff cờ bang hội cho người chơi (EXP x1.1, GOLD x1.1)
   */
  getFlagBuff(playerObj) {
    if (!playerObj || !playerObj.guild_id) return null;
    const holderId = this.getFlagHoldingGuildId();
    const myGid = Number(playerObj.guild_id);

    if (myGid === holderId || this.isAllied(myGid, holderId)) {
      return { e: 1.1, g: 1.1 };
    }
    return null;
  }

  /**
   * Tính số giờ còn lại của cooldown gia nhập bang (nếu có)
   */
  getJoinCooldownHours(playerObj) {
    if (!playerObj || !playerObj.guild_id) return 0;
    db.load();
    if (!db.data || !Array.isArray(db.data.guilds)) return 0;

    const myGid = Number(playerObj.guild_id);
    const guild = db.data.guilds.find(g => Number(g.id) === myGid);
    if (!guild || !Array.isArray(guild.members)) return 0;

    const member = guild.members.find(m => m.uid === playerObj.line_uid);
    if (!member || !member.joined_at) return 0;

    const nowSec = Math.floor(Date.now() / 1000);
    const deltaSec = nowSec - member.joined_at;
    const cooldownSec = this.JOIN_COOLDOWN_HOURS * 3600;

    if (deltaSec < cooldownSec) {
      return Math.ceil((cooldownSec - deltaSec) / 3600);
    }

    return 0;
  }

  /**
   * Cập nhật và kiểm tra tiến trình thời gian thực của Chiến tranh Bang hội
   */
  tickSchedule() {
    const nowSec = Math.floor(Date.now() / 1000);

    // Nếu đang ở trạng thái OPEN và đã đến giờ FIGHT
    if (this.state.st === 'open' && nowSec >= this.state.fight_at) {
      this.state.st = 'fight';
      this.saveRuntime();
    }
    // Nếu đang ở trạng thái FIGHT và đã đến giờ END
    else if (this.state.st === 'fight' && nowSec >= this.state.end_at) {
      this.settleWar();
    }
  }

  /**
   * Người chơi tham gia chiến trường Bang hội (action: 'gwar_join')
   */
  joinWar(playerObj) {
    this.tickSchedule();

    const gid = Number(playerObj.guild_id);
    if (!gid) {
      return {
        ok: false,
        error: 'Bạn cần ở trong một bang hội để tham gia công thành!'
      };
    }

    const cd_h = this.getJoinCooldownHours(playerObj);
    if (cd_h > 0) {
      return {
        ok: false,
        error: `Bạn cần ở trong bang đủ 48 giờ mới có thể tham chiến (còn lại ${cd_h} giờ)!`
      };
    }

    if (this.state.st !== 'open' && this.state.st !== 'fight') {
      return {
        ok: false,
        error: 'Chiến trường Bang hội hiện chưa mở cửa!'
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const uid = playerObj.line_uid;

    db.load();
    const guild = (db.data && Array.isArray(db.data.guilds)) ? db.data.guilds.find(g => Number(g.id) === gid) : null;
    const guildName = guild ? guild.name : `Bang ${gid}`;

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

    // Khởi tạo điểm cho bang nếu chưa có
    if (!this.scores[gid]) {
      this.scores[gid] = { p: 0, last_score_ts: nowSec, name: guildName };
    }

    // Đăng ký người tham chiến
    this.participants[uid] = {
      line_uid: uid,
      name: playerObj.display_name || playerObj.name || uid,
      guild_id: gid,
      guild_name: guildName,
      lv: playerObj.lv || 1,
      joined_at: nowSec,
      kills: 0,
      deaths: 0,
      home_return: playerObj.home_return,
      col_sh_until: playerObj.col_sh_until
    };

    this.saveRuntime();

    return {
      ok: true,
      map: this.MAP_ID,
      x: playerObj.x,
      y: playerObj.y
    };
  }

  /**
   * Ghi nhận một pha hạ gục trên chiến trường Bang hội Map 4 (Server-Authoritative)
   */
  recordKill(killerPlayer, victimPlayer, eventId = null) {
    this.tickSchedule();

    if (this.state.st !== 'fight') {
      return { ok: false, error: 'Chiến trường chưa bắt đầu hoặc đã kết thúc' };
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Chống lặp event kill nếu có eventId
    if (eventId) {
      if (this.processedKills.has(eventId)) {
        return { ok: true, duplicate: true };
      }
      this.processedKills.add(eventId);
    }

    const killerUid = killerPlayer.line_uid;
    const victimUid = victimPlayer.line_uid || victimPlayer.uid;
    const killerGid = Number(killerPlayer.guild_id);
    const victimGid = Number(victimPlayer.guild_id || victimPlayer.gid);

    if (!killerGid || !victimGid) {
      return { ok: false, error: 'Người chơi không thuộc bang hội' };
    }

    // 1. Chặn Friendly Fire cùng bang
    if (killerGid === victimGid) {
      return { ok: false, error: 'Không thể tấn công thành viên cùng bang' };
    }

    // 2. Chặn Friendly Fire bang đồng minh
    if (this.isAllied(killerGid, victimGid)) {
      return { ok: false, error: 'Không thể tấn công thành viên bang đồng minh' };
    }

    // 3. Kiểm tra khiên hồi sinh
    if (victimPlayer.col_sh_until && victimPlayer.col_sh_until > nowSec) {
      return { ok: false, error: 'Mục tiêu đang trong trạng thái khiên bảo vệ' };
    }

    // Cấp khiên hồi sinh 5 giây cho nạn nhân sau khi bị hạ
    victimPlayer.col_sh_until = nowSec + this.SPAWN_SHIELD_SEC;

    db.load();
    const killerGuild = (db.data && Array.isArray(db.data.guilds)) ? db.data.guilds.find(g => Number(g.id) === killerGid) : null;
    const victimGuild = (db.data && Array.isArray(db.data.guilds)) ? db.data.guilds.find(g => Number(g.id) === victimGid) : null;
    const killerGuildName = killerGuild ? killerGuild.name : (this.scores[killerGid] ? this.scores[killerGid].name : `Bang ${killerGid}`);
    const victimGuildName = victimGuild ? victimGuild.name : (this.scores[victimGid] ? this.scores[victimGid].name : `Bang ${victimGid}`);

    // Cập nhật stats người chơi
    if (this.participants[killerUid]) {
      this.participants[killerUid].kills++;
    }
    if (this.participants[victimUid]) {
      this.participants[victimUid].deaths++;
      this.participants[victimUid].col_sh_until = victimPlayer.col_sh_until;
    }

    // 4. Tính toán điểm số
    let pts = 0;
    const victimLv = victimPlayer.lv || 1;

    // Yêu cầu Level >= 40
    if (victimLv >= this.MIN_LV) {
      const victimKey = `${killerGid}_${victimUid}`;
      const priorKills = this.victimKills[victimKey] || 0;

      // Giới hạn tối đa 3 điểm/nạn nhân/trận chiến
      if (priorKills < this.MAX_POINTS_PER_VICTIM) {
        this.victimKills[victimKey] = priorKills + 1;
        pts = this.PPK;
      }
    }

    if (pts > 0) {
      if (!this.scores[killerGid]) {
        this.scores[killerGid] = { p: 0, last_score_ts: nowSec, name: killerGuildName };
      }
      this.scores[killerGid].p += pts;
      this.scores[killerGid].last_score_ts = nowSec;
      this.scores[killerGid].name = killerGuildName;
    }

    // 5. Ghi feed lịch sử
    const feedItem = {
      id: `gkill_${nowSec}_${Math.random().toString(36).slice(2, 8)}`,
      t: nowSec,
      k: killerPlayer.display_name || killerPlayer.name || killerUid,
      kt: killerGuildName,
      v: victimPlayer.display_name || victimPlayer.name || victimUid,
      vt: victimGuildName,
      p: pts
    };

    this.feed.unshift(feedItem);
    if (this.feed.length > 50) {
      this.feed.pop();
    }

    // Lưu feed và runtime vào DB
    try {
      db.load();
      db.data.gwar_feed = this.feed;
      db.data.gwar_runtime = {
        state: this.state,
        scores: this.scores,
        participants: this.participants,
        victimKills: this.victimKills,
        processedKills: Array.from(this.processedKills)
      };
      db.save();
    } catch (e) {
      console.error('Lỗi khi lưu feed GWar:', e);
    }

    return {
      ok: true,
      pts: pts,
      feedItem: feedItem
    };
  }

  /**
   * Lấy bảng xếp hạng điểm hiện tại của các bang
   */
  getRankings() {
    const arr = Object.keys(this.scores).map(gid => {
      const numGid = Number(gid);
      return {
        g: numGid,
        n: this.scores[gid].name || `Bang ${gid}`,
        p: this.scores[gid].p || 0,
        last_score_ts: this.scores[gid].last_score_ts || 0
      };
    });

    // Sắp xếp: Điểm cao hơn xếp trước; nếu bằng điểm thì ai đạt điểm trước (last_score_ts nhỏ hơn) xếp trước
    arr.sort((a, b) => {
      if (b.p !== a.p) {
        return b.p - a.p;
      }
      return a.last_score_ts - b.last_score_ts;
    });

    return arr;
  }

  /**
   * Kết thúc và thanh toán kết quả chiến tranh Bang hội (Settle War)
   */
  settleWar() {
    const nowSec = Math.floor(Date.now() / 1000);
    this.state.st = 'ended';
    this.state.seen_end_t = nowSec;

    const rankings = this.getRankings();
    const distinctGuilds = new Set(Object.values(this.participants).map(p => Number(p.guild_id))).size;
    const totalParticipants = Object.keys(this.participants).length;

    // Kiểm tra quorum: Tối thiểu 2 bang và 4 người
    if (distinctGuilds < this.MIN_GUILDS || totalParticipants < this.MIN_PARTICIPANTS) {
      this.state.cancel = true;
    } else {
      this.state.cancel = false;
    }

    try {
      db.load();
      if (!db.data.gwar_flag) {
        db.data.gwar_flag = { holder_id: 1, holder_name: 'Ragnalok', streak: 1, won_at: nowSec };
      }

      if (this.state.cancel) {
        // Hủy chiến -> giữ nguyên cờ cũ, tăng streak thêm 1 ngày
        db.data.gwar_flag.streak = (db.data.gwar_flag.streak || 1) + 1;
      } else if (rankings.length > 0 && rankings[0].p > 0) {
        const winner = rankings[0];
        if (Number(db.data.gwar_flag.holder_id) === Number(winner.g)) {
          db.data.gwar_flag.streak = (db.data.gwar_flag.streak || 1) + 1;
        } else {
          db.data.gwar_flag.holder_id = Number(winner.g);
          db.data.gwar_flag.holder_name = winner.n;
          db.data.gwar_flag.streak = 1;
        }
        db.data.gwar_flag.won_at = nowSec;
      }

      // Ghi lịch sử chiến tranh
      const dateStr = new Date(nowSec * 1000).toISOString().split('T')[0];
      const histItem = {
        fight_id: this.state.fight_id || nowSec,
        date: dateStr,
        winner_id: db.data.gwar_flag.holder_id,
        winner_name: db.data.gwar_flag.holder_name,
        points: (rankings.length > 0) ? rankings[0].p : 0,
        streak: db.data.gwar_flag.streak || 1,
        cancel: this.state.cancel,
        top: rankings.slice(0, 3)
      };

      if (!Array.isArray(db.data.gwar_history)) {
        db.data.gwar_history = [];
      }
      db.data.gwar_history.unshift(histItem);
      if (db.data.gwar_history.length > 30) {
        db.data.gwar_history.pop();
      }

      db.data.gwar_runtime = {
        state: this.state,
        scores: this.scores,
        participants: this.participants,
        victimKills: this.victimKills,
        processedKills: Array.from(this.processedKills)
      };

      db.save();
    } catch (e) {
      console.error('Lỗi khi thanh toán GWar DB:', e);
    }

    // Tự động đưa toàn bộ người chơi tham chiến trên Map 4 về vị trí xuất phát
    this.cleanupAndReturnPlayers();
  }

  /**
   * Tự động đưa người chơi tham gia trên Map 4 về điểm xuất phát ban đầu (home_return)
   */
  cleanupAndReturnPlayers() {
    try {
      db.load();
      if (!db.data || !Array.isArray(db.data.players)) return;

      let changed = false;
      Object.keys(this.participants).forEach(uid => {
        const pRow = db.data.players.find(p => p.line_uid === uid);
        if (pRow) {
          try {
            const pObj = JSON.parse(pRow.raw_data);
            if (pObj.map === this.MAP_ID) {
              const ret = pObj.home_return || { map: 1, x: 1125, y: 1125 };
              pObj.map = ret.map || 1;
              pObj.x = ret.x || 1125;
              pObj.y = ret.y || 1125;
              pObj.explore_cx = pObj.x;
              pObj.explore_cy = pObj.y;
              delete pObj.home_return;
              delete pObj.col_sh_until;

              pRow.raw_data = JSON.stringify(pObj);
              changed = true;
            }
          } catch (e) {}
        }
      });

      if (changed) {
        db.save();
      }
    } catch (e) {
      console.error('Lỗi khi cleanupAndReturnPlayers GWar:', e);
    }
  }

  /**
   * Trả về cấu trúc trạng thái `gw` cho Game Poll (/xhrpg_game.php)
   */
  getWarStatus(playerObj) {
    this.tickSchedule();

    const nowSec = Math.floor(Date.now() / 1000);
    const myGid = (playerObj && playerObj.guild_id) ? Number(playerObj.guild_id) : 0;
    const cd_h = this.getJoinCooldownHours(playerObj);

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
        can: !!(myGid && cd_h === 0),
        cd_h: cd_h,
        in_arena: inArena,
        n: Object.keys(this.participants).length,
        top: rankings.slice(0, 5),
        gid: myGid,
        my: myScore
      };
    }

    if (this.state.st === 'ended') {
      db.load();
      const flagData = (db.data && db.data.gwar_flag) ? db.data.gwar_flag : { holder_id: 1, holder_name: 'Ragnalok', streak: 1 };
      const rankings = this.getRankings();
      const isMine = !!(myGid && myGid === Number(flagData.holder_id));

      return {
        st: 'ended',
        t: this.state.seen_end_t || nowSec,
        cancel: !!this.state.cancel,
        mine: isMine,
        name: flagData.holder_name,
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
  getWarLog(kind = 'gw') {
    db.load();
    const feed = (db.data && Array.isArray(db.data.gwar_feed)) ? db.data.gwar_feed : this.feed;
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

    this.saveRuntime();
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
    this.victimKills = {};
    this.processedKills.clear();

    this.saveRuntime();
  }
}

module.exports = new GWarManager();
