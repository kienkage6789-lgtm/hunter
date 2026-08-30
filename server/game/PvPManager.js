const combatEngine = require('./CombatEngine');
const db = require('../db/queries');

const PVP_DIV = 30;

class PvPManager {
  constructor() {
    this.activeDuels = new Map(); // duelId -> duelState
    this.playerDuelMap = new Map(); // line_uid -> duelId
    this.pendingInvites = new Map(); // target_uid -> inviteState
    this.duelCounter = 0;
  }

  // 1. Tạo trận đấu bóng (Shadow Duel)
  createShadowDuel(challengerObj, targetObj) {
    if (!challengerObj || !targetObj) return null;
    const cUid = challengerObj.line_uid;
    const tUid = targetObj.line_uid;

    if (this.playerDuelMap.has(cUid)) {
      this.cancelPlayerDuel(cUid);
    }

    const duelId = 'shadow_' + (++this.duelCounter) + '_' + Date.now();
    const cHpMax = parseInt(challengerObj.hp_max) || 300;
    const tHpMax = parseInt(targetObj.hp_max) || 300;

    const duel = {
      id: duelId,
      isShadow: true,
      createdAt: Date.now(),
      startTime: Date.now(),
      state: 'count', // count -> fight -> ended
      countDown: 3,
      duration: 60, // 60s max combat
      lastTickAt: Date.now(),
      p1: {
        uid: cUid,
        name: challengerObj.name || 'Người chơi',
        lv: challengerObj.lv || 1,
        cc: challengerObj.country || challengerObj.last_cc || 'VN',
        vip: challengerObj.vip_lv || 0,
        hp: cHpMax,
        hp_max: cHpMax,
        rawObj: challengerObj
      },
      p2: {
        uid: tUid,
        name: targetObj.name || 'Bóng đối thủ',
        lv: targetObj.lv || 1,
        cc: targetObj.country || targetObj.last_cc || 'VN',
        vip: targetObj.vip_lv || 0,
        hp: tHpMax,
        hp_max: tHpMax,
        rawObj: targetObj
      },
      events: {
        [cUid]: []
      }
    };

    this.activeDuels.set(duelId, duel);
    this.playerDuelMap.set(cUid, duelId);
    return duel;
  }

  // 2. Tạo lời mời đấu trực tiếp (Live Duel)
  createLiveDuelInvite(challengerObj, targetObj) {
    if (!challengerObj || !targetObj) return { ok: false, error: 'invalid_players' };
    const cUid = challengerObj.line_uid;
    const tUid = targetObj.line_uid;

    if (cUid === tUid) return { ok: false, error: 'cannot_challenge_self', msg: 'Không thể tự thách đấu chính mình!' };
    if (this.playerDuelMap.has(cUid)) return { ok: false, error: 'already_in_duel', msg: 'Bạn đang trong một trận đấu khác!' };
    if (this.playerDuelMap.has(tUid)) return { ok: false, error: 'target_in_duel', msg: 'Đối thủ đang trong một trận đấu khác!' };

    const duelId = 'live_' + (++this.duelCounter) + '_' + Date.now();
    const invite = {
      id: duelId,
      challengerUid: cUid,
      challengerName: challengerObj.name || 'Người chơi',
      challengerLv: challengerObj.lv || 1,
      targetUid: tUid,
      targetName: targetObj.name || 'Đối thủ',
      targetLv: targetObj.lv || 1,
      createdAt: Date.now(),
      expiresAt: Date.now() + 15000 // 15s timeout
    };

    this.pendingInvites.set(tUid, invite);
    this.playerDuelMap.set(cUid, duelId);

    return { ok: true, msg: 'Đã gửi lời mời thách đấu tới ' + invite.targetName };
  }

  // 3. Chấp nhận lời mời
  acceptInvite(targetUid, targetPlayerObj, challengerPlayerObj) {
    const invite = this.pendingInvites.get(targetUid);
    if (!invite) return { ok: false, error: 'no_invite', msg: 'Không có lời mời thách đấu nào!' };
    if (Date.now() > invite.expiresAt) {
      this.pendingInvites.delete(targetUid);
      this.playerDuelMap.delete(invite.challengerUid);
      return { ok: false, error: 'invite_expired', msg: 'Lời mời thách đấu đã hết hạn!' };
    }

    const cUid = invite.challengerUid;
    const cHpMax = parseInt(challengerPlayerObj.hp_max) || 300;
    const tHpMax = parseInt(targetPlayerObj.hp_max) || 300;

    const duel = {
      id: invite.id,
      isShadow: false,
      createdAt: Date.now(),
      startTime: Date.now(),
      state: 'count', // count -> fight -> ended
      countDown: 3,
      duration: 60,
      lastTickAt: Date.now(),
      p1: {
        uid: cUid,
        name: challengerPlayerObj.name || invite.challengerName,
        lv: challengerPlayerObj.lv || invite.challengerLv,
        cc: challengerPlayerObj.country || challengerPlayerObj.last_cc || 'VN',
        vip: challengerPlayerObj.vip_lv || 0,
        hp: cHpMax,
        hp_max: cHpMax,
        rawObj: challengerPlayerObj
      },
      p2: {
        uid: targetUid,
        name: targetPlayerObj.name || invite.targetName,
        lv: targetPlayerObj.lv || invite.targetLv,
        cc: targetPlayerObj.country || targetPlayerObj.last_cc || 'VN',
        vip: targetPlayerObj.vip_lv || 0,
        hp: tHpMax,
        hp_max: tHpMax,
        rawObj: targetPlayerObj
      },
      events: {
        [cUid]: [],
        [targetUid]: []
      }
    };

    this.pendingInvites.delete(targetUid);
    this.activeDuels.set(duel.id, duel);
    this.playerDuelMap.set(cUid, duel.id);
    this.playerDuelMap.set(targetUid, duel.id);

    return { ok: true, msg: 'Bắt đầu thách đấu!' };
  }

  // 4. Từ chối lời mời
  declineInvite(targetUid) {
    const invite = this.pendingInvites.get(targetUid);
    if (!invite) return { ok: false, error: 'no_invite' };
    this.pendingInvites.delete(targetUid);
    this.playerDuelMap.delete(invite.challengerUid);
    return { ok: true, msg: 'Đã từ chối lời mời thách đấu!' };
  }

  // 5. Đầu hàng trận đấu
  forfeitDuel(lineUid) {
    const duelId = this.playerDuelMap.get(lineUid);
    if (!duelId) return { ok: false, error: 'not_in_duel', msg: 'Bạn không ở trong trận đấu nào!' };
    const duel = this.activeDuels.get(duelId);
    if (!duel) {
      this.playerDuelMap.delete(lineUid);
      return { ok: false, error: 'duel_not_found', msg: 'Trận đấu không tồn tại!' };
    }

    const isP1 = duel.p1.uid === lineUid;
    const winnerUid = isP1 ? duel.p2.uid : duel.p1.uid;
    const loserUid = lineUid;

    this.settleDuel(duel, winnerUid, loserUid, false);
    return { ok: true, msg: 'Bạn đã đầu hàng trận đấu!' };
  }

  cancelPlayerDuel(lineUid) {
    const duelId = this.playerDuelMap.get(lineUid);
    if (duelId) {
      this.activeDuels.delete(duelId);
      this.playerDuelMap.delete(lineUid);
    }
    this.pendingInvites.delete(lineUid);
  }

  // 6. Tính toán nhịp chiến đấu (Tick) cho người chơi
  tickPlayer(lineUid, playerObj) {
    // 6.1 Kiểm tra xem có đang có lời mời chờ không
    const invite = this.pendingInvites.get(lineUid);
    if (invite) {
      const leftSec = Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000));
      if (leftSec <= 0) {
        this.pendingInvites.delete(lineUid);
        this.playerDuelMap.delete(invite.challengerUid);
      } else {
        return {
          pvp: {
            id: invite.id,
            ph: 'invite',
            opp: invite.challengerName,
            opp_lv: invite.challengerLv,
            t: leftSec
          },
          events: []
        };
      }
    }

    // 6.2 Kiểm tra xem có đang ở trong trận đấu không
    const duelId = this.playerDuelMap.get(lineUid);
    if (!duelId) return { pvp: null, events: [] };

    // Kiểm tra xem có phải là người đang đợi phản hồi lời mời không
    for (const [tUid, inv] of this.pendingInvites.entries()) {
      if (inv.id === duelId && inv.challengerUid === lineUid) {
        const leftSec = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 1000));
        if (leftSec <= 0) {
          this.pendingInvites.delete(tUid);
          this.playerDuelMap.delete(lineUid);
          return { pvp: null, events: [] };
        }
        return {
          pvp: {
            id: inv.id,
            ph: 'wait',
            opp: inv.targetName,
            opp_lv: inv.targetLv,
            t: leftSec
          },
          events: []
        };
      }
    }

    const duel = this.activeDuels.get(duelId);
    if (!duel) {
      this.playerDuelMap.delete(lineUid);
      return { pvp: null, events: [] };
    }

    const isP1 = duel.p1.uid === lineUid;
    const me = isP1 ? duel.p1 : duel.p2;
    const opp = isP1 ? duel.p2 : duel.p1;
    const now = Date.now();

    // 6.3 Xử lý phase COUNT (đếm ngược 3s)
    if (duel.state === 'count') {
      const elapsedSinceStart = (now - duel.startTime) / 1000;
      const count = Math.ceil(3 - elapsedSinceStart);
      if (count <= 0) {
        duel.state = 'fight';
        duel.fightStartTime = now;
        duel.lastTickAt = now;
      } else {
        return {
          pvp: {
            id: duel.id,
            ph: 'count',
            n: count,
            opp: opp.name,
            opp_lv: opp.lv,
            opp_hp: opp.hp,
            opp_hpm: opp.hp_max,
            my_hpm: me.hp_max
          },
          events: []
        };
      }
    }

    // 6.4 Xử lý phase FIGHT (giao tranh)
    if (duel.state === 'fight') {
      const elapsedSec = Math.floor((now - duel.lastTickAt) / 1000);
      const myEvents = duel.events[lineUid] || [];
      duel.events[lineUid] = [];

      if (elapsedSec >= 1) {
        duel.lastTickAt = now;
        const ticksToRun = Math.min(5, elapsedSec);

        for (let i = 0; i < ticksToRun; i++) {
          if (duel.p1.hp <= 0 || duel.p2.hp <= 0) break;

          // P1 đánh P2
          const p1DmgResult = this.calcPvPDamage(duel.p1.rawObj, duel.p2.rawObj);
          duel.p2.hp = Math.max(0, duel.p2.hp - p1DmgResult.dmg);

          // P2 đánh P1
          const p2DmgResult = this.calcPvPDamage(duel.p2.rawObj, duel.p1.rawObj);
          duel.p1.hp = Math.max(0, duel.p1.hp - p2DmgResult.dmg);

          // Bắn sự kiện pvp_hit
          if (duel.events[duel.p1.uid]) {
            duel.events[duel.p1.uid].push({ type: 'pvp_hit', dmg: p2DmgResult.dmg });
          }
          if (duel.events[duel.p2.uid]) {
            duel.events[duel.p2.uid].push({ type: 'pvp_hit', dmg: p1DmgResult.dmg });
          }
        }
      }

      const fightElapsed = (now - duel.fightStartTime) / 1000;
      const timeLeft = Math.max(0, Math.ceil(duel.duration - fightElapsed));

      // Kiểm tra kết thúc trận
      const p1Dead = duel.p1.hp <= 0;
      const p2Dead = duel.p2.hp <= 0;
      const timedOut = timeLeft <= 0;

      if (p1Dead || p2Dead || timedOut) {
        let winnerUid = null;
        let loserUid = null;
        let isDraw = false;

        if (p1Dead && !p2Dead) {
          winnerUid = duel.p2.uid;
          loserUid = duel.p1.uid;
        } else if (p2Dead && !p1Dead) {
          winnerUid = duel.p1.uid;
          loserUid = duel.p2.uid;
        } else if (p1Dead && p2Dead) {
          isDraw = true;
        } else if (timedOut) {
          const p1Pct = duel.p1.hp / duel.p1.hp_max;
          const p2Pct = duel.p2.hp / duel.p2.hp_max;
          if (p1Pct > p2Pct) {
            winnerUid = duel.p1.uid;
            loserUid = duel.p2.uid;
          } else if (p2Pct > p1Pct) {
            winnerUid = duel.p2.uid;
            loserUid = duel.p1.uid;
          } else {
            isDraw = true;
          }
        }

        this.settleDuel(duel, winnerUid, loserUid, isDraw);

        const isWin = isDraw ? -1 : (winnerUid === lineUid ? 1 : 0);
        myEvents.push({ type: 'pvp_end', win: isWin });

        // Cập nhật vị trí hồi sinh cho người thua
        if (isWin === 0) {
          playerObj.x = 1125;
          playerObj.y = 1125;
          playerObj.hp = me.hp_max;
        }

        return {
          pvp: null,
          events: myEvents
        };
      }

      return {
        pvp: {
          id: duel.id,
          ph: 'fight',
          opp: opp.name,
          opp_lv: opp.lv,
          opp_hp: opp.hp,
          opp_hpm: opp.hp_max,
          my_hpm: me.hp_max,
          t: timeLeft
        },
        events: myEvents
      };
    }

    return { pvp: null, events: [] };
  }

  // 7. Tính toán sát thương PvP
  calcPvPDamage(attacker, defender) {
    if (!attacker || !defender) return { dmg: 5, crit: 0 };
    const weapon = attacker.active_gun ? (attacker.active_gun === 1 ? 'pistol' : 'sniper') : 'knife';
    const rawResult = combatEngine.calculateDamage(attacker, defender, weapon);
    const pvpDmg = Math.max(1, Math.round(rawResult.dmg / PVP_DIV));
    return {
      dmg: pvpDmg,
      crit: rawResult.crit
    };
  }

  // 8. Kết toán trận đấu và lưu vào Database
  settleDuel(duel, winnerUid, loserUid, isDraw = false) {
    if (duel.state === 'ended') return;
    duel.state = 'ended';

    const duration = Math.max(1, Math.round((Date.now() - duel.startTime) / 1000));
    const nowStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    db.load();
    db.data.pvp_log = db.data.pvp_log || [];
    db.data.pvp_rank = db.data.pvp_rank || [];

    const p1 = duel.p1;
    const p2 = duel.p2;

    const winner = winnerUid === p1.uid ? p1 : p2;
    const loser = loserUid === p1.uid ? p1 : p2;

    if (!isDraw && winner) {
      db.data.pvp_log.unshift({
        id: duel.id,
        winner_uid: winner.uid,
        winner_name: winner.name,
        w_lv: winner.lv,
        w_cc: winner.cc,
        loser_uid: loser.uid,
        loser_name: loser.name,
        l_lv: loser.lv,
        l_cc: loser.cc,
        duration_s: duration,
        created_at: nowStr
      });

      if (db.data.pvp_log.length > 100) {
        db.data.pvp_log = db.data.pvp_log.slice(0, 100);
      }

      // Cập nhật pvp_rank
      let rankEntry = db.data.pvp_rank.find(r => r.winner_uid === winner.uid);
      if (!rankEntry) {
        rankEntry = {
          winner_uid: winner.uid,
          name: winner.name,
          lv: winner.lv,
          cc: winner.cc,
          wins: 0
        };
        db.data.pvp_rank.push(rankEntry);
      }
      rankEntry.wins = (rankEntry.wins || 0) + 1;
      rankEntry.lv = winner.lv;
      rankEntry.name = winner.name;
      rankEntry.cc = winner.cc;

      // Cập nhật player record
      const winnerPlayer = db.data.players.find(p => p.line_uid === winner.uid);
      if (winnerPlayer) {
        try {
          const parsed = JSON.parse(winnerPlayer.raw_data);
          parsed.pvp_wins = (parsed.pvp_wins || 0) + 1;
          winnerPlayer.raw_data = JSON.stringify(parsed);
        } catch (e) {}
      }

      db.save();
    }

    // Dọn dẹp duel
    this.activeDuels.delete(duel.id);
    this.playerDuelMap.delete(duel.p1.uid);
    this.playerDuelMap.delete(duel.p2.uid);
  }

  // 9. Lấy log PvP
  getPvpLogs() {
    db.load();
    return (db.data.pvp_log || []).slice(0, 20);
  }

  // 10. Lấy bảng xếp hạng PvP
  getPvpRanks() {
    db.load();
    const list = (db.data.pvp_rank || []).slice();
    list.sort((a, b) => (b.wins || 0) - (a.wins || 0));
    return list.slice(0, 50);
  }
}

module.exports = new PvPManager();

