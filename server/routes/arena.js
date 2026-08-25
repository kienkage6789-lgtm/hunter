const express = require('express');
const db = require('../db/queries');

const router = express.Router();

// Danh sách BOSS Đấu trường mặc định
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

router.post('/', (req, res) => {
  const { line_uid, action, mid, pay, count } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  db.load();

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

  const playerLv = playerObj.lv || 1;

  // Khởi tạo lịch sử thắng đấu trường nếu chưa có
  if (!playerObj.arena_won) {
    playerObj.arena_won = [];
  }

  // 1. Lấy thông tin đấu trường (action === 'info')
  if (action === 'info') {
    const bosses = [];
    const locked = [];

    for (const b of ARENA_BOSSES) {
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

    return res.json({
      ok: true,
      free_max: 5,
      used: playerObj.arena_used || 0,
      paid_max: 20,
      paid: playerObj.arena_paid || 0,
      in_arena: false,
      bosses: bosses,
      locked: locked
    });
  }

  // 2. Tham gia thách đấu hoặc Càn quét (action === 'enter' hoặc 'skip')
  if (action === 'enter' || action === 'skip') {
    const bossId = parseInt(mid);
    const boss = ARENA_BOSSES.find(x => x.mid === bossId);
    if (!boss) {
      return res.json({ ok: false, error: 'Không tìm thấy BOSS tương ứng!' });
    }

    if (playerLv < boss.unlock_lv) {
      return res.json({ ok: false, error: 'BOSS này chưa được mở khóa!' });
    }

    const isSkip = action === 'skip';
    if (isSkip && !playerObj.arena_won.includes(bossId)) {
      return res.json({ ok: false, error: 'Bạn phải thắng BOSS này ít nhất một lần để sử dụng Càn quét!' });
    }

    const repeat = parseInt(count) || 1;
    const ticketCost = boss.ticket * repeat;
    const pointsCost = boss.pcost * repeat;

    // Kiểm tra & trừ chi phí
    if (pay === 'g') {
      const playerGold = playerObj.gold || 0;
      if (playerGold < ticketCost) {
        return res.json({ ok: false, error: 'Không đủ Vàng để tham gia!' });
      }
      playerObj.gold = playerGold - ticketCost;
    } else if (pay === 'p') {
      const playerPts = playerObj.p_points || 0;
      if (playerPts < pointsCost) {
        return res.json({ ok: false, error: 'Không đủ điểm Premium (P) để tham gia!' });
      }
      playerObj.p_points = playerPts - pointsCost;
    } else {
      return res.json({ ok: false, error: 'Phương thức thanh toán không hợp lệ!' });
    }

    // Tăng số lần sử dụng trong ngày
    if (pay === 'g') {
      playerObj.arena_used = (playerObj.arena_used || 0) + repeat;
    } else {
      playerObj.arena_paid = (playerObj.arena_paid || 0) + repeat;
    }

    // Đánh bại boss, cộng phần thưởng
    const expReward = boss.lv * 150 * repeat;
    const goldReward = boss.lv * 300 * repeat;

    playerObj.exp = (playerObj.exp || 0) + expReward;
    playerObj.gold = (playerObj.gold || 0) + goldReward;

    // Đánh dấu đã thắng boss này
    if (!playerObj.arena_won.includes(bossId)) {
      playerObj.arena_won.push(bossId);
    }

    // Cập nhật DB
    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(
      JSON.stringify(playerObj), line_uid
    );

    const actionText = isSkip ? `Càn quét ${repeat} lần` : 'Thách đấu';
    return res.json({
      ok: true,
      msg: `⚔️ ${actionText} BOSS ${boss.name} thành công! Nhận được ${expReward} EXP và ${goldReward} Gold.`
    });
  }

  res.json({ ok: false, error: 'Unknown action' });
});

module.exports = router;
