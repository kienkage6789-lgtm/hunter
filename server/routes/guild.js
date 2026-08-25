const express = require('express');
const db = require('../db/queries');
const worldManager = require('../game/WorldManager');

const router = express.Router();

// Helper to calculate guild level up cost
function guildExpNext(lv) {
  return lv * 1000000; // 1M gold equivalent exp per level
}

// Helper to get active player online status
function isPlayerOnline(uid) {
  const active = worldManager.activePlayers.get(uid);
  if (!active) return false;
  return (Date.now() - active.lastSeen) < 60000; // Online if active in the last 60 seconds
}

router.post('/', (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid) {
    return res.json({ ok: false, error: 'Missing line_uid' });
  }

  db.load();
  
  // Verify user session
  if (session_token) {
    const user = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!user) {
      return res.json({ ok: false, error: 'Invalid session' });
    }
  }

  // Load player raw_data
  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.json({ ok: false, error: 'Player not found' });
  }

  let player;
  try {
    player = JSON.parse(pRow.raw_data);
  } catch (e) {
    player = { line_uid };
  }

  // Ensure guilds and alliances exist in database
  db.data.guilds = db.data.guilds || [];
  db.data.alliances = db.data.alliances || [];

  const guild = db.data.guilds.find(g => g.id === player.guild_id);

  // 1. INFO Action
  if (action === 'info') {
    if (!guild) {
      const cdSecs = player.guild_left_at 
        ? Math.max(0, 24 * 3600 - (Math.floor(Date.now() / 1000) - player.guild_left_at))
        : 0;
      return res.json({ ok: true, none: true, cd: cdSecs, msg: 'Hiện chưa có Bang hội.' });
    }

    const meInGuild = guild.members.find(m => m.uid === player.line_uid);
    if (!meInGuild) {
      // Inconsistent state, reset player guild_id
      player.guild_id = 0;
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
      return res.json({ ok: true, none: true, msg: 'Hiện chưa có Bang hội.' });
    }

    const isLdOrOf = meInGuild.role === 'leader' || meInGuild.role === 'officer';

    // Map members array
    const members = guild.members.map(m => {
      const memRow = db.data.players.find(p => p.line_uid === m.uid);
      let memName = m.uid;
      let memLv = 1;
      let lastFlush = Math.floor(Date.now() / 1000) - 3600; // fallback last seen
      if (memRow) {
        memName = memRow.name;
        memLv = memRow.lv;
        try {
          const parsed = JSON.parse(memRow.raw_data);
          if (parsed.display_name) memName = parsed.display_name;
          if (parsed.last_flush) lastFlush = parsed.last_flush;
        } catch(e) {}
      }

      const mm = {
        uid: m.uid,
        name: memName,
        lv: memLv,
        role: m.role,
        ct: m.ct || 0,
        me: m.uid === player.line_uid
      };

      if (isLdOrOf) {
        mm.on = isPlayerOnline(m.uid);
        mm.lf = lastFlush;
      }

      return mm;
    });

    const dMe = {
      role: meInGuild.role,
      ct: meInGuild.ct || 0
    };

    // Calculate progress pct
    const gPct = Math.floor(((guild.exp || 0) / guildExpNext(guild.lv || 1)) * 100);

    const dG = {
      id: guild.id,
      name: guild.name,
      lv: guild.lv || 1,
      n: guild.members.length,
      cap: 20 + (guild.lv || 1) * 2,
      sh: guild.sh || 0,
      co: guild.co || 0,
      ic: guild.ic || 0,
      notice: guild.notice || '',
      pct: gPct,
      ex: guild.exp || 0,
      nx: guildExpNext(guild.lv || 1)
    };

    // Daily donation resources configuration
    const todayStr = new Date().toISOString().slice(0, 10);
    if (player.guild_donated_date !== todayStr) {
      player.guild_donated_today = {};
      player.guild_donated_date = todayStr;
      db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    }

    const getResLeft = (f, cap) => {
      const donated = (player.guild_donated_today && player.guild_donated_today[f]) || 0;
      return Math.max(0, cap - donated);
    };

    const dRes = {
      on: 1,
      rate: 1000,
      max: 10000,
      list: [
        { f: 'wood', rate: 200, left: getResLeft('wood', 100), cap: 100, val: 0 },
        { f: 'stone', rate: 200, left: getResLeft('stone', 100), cap: 100, val: 0 },
        { f: 'iron', rate: 400, left: getResLeft('iron', 50), cap: 50, val: 0 },
        { f: 'copper', rate: 400, left: getResLeft('copper', 50), cap: 50, val: 0 },
        { f: 'herb', rate: 300, left: getResLeft('herb', 80), cap: 80, val: 0 },
        { f: 'diamond_blue', rate: 50000, left: getResLeft('diamond_blue', 5), cap: 5, val: 1 },
        { f: 'diamond_red', rate: 150000, left: getResLeft('diamond_red', 2), cap: 2, val: 1 }
      ]
    };

    // Ore information
    const dOre = {
      lv: (guild.ore && guild.ore.lv) || 1,
      have: (guild.ore && guild.ore.have) || { ore1: 0, ore2: 0, ore3: 0 },
      need: (guild.ore && guild.ore.need) || { ore1: 100, ore2: 50, ore3: 20 },
      mine: {
        ore1: player.ore1 || 0,
        ore2: player.ore2 || 0,
        ore3: player.ore3 || 0
      }
    };

    // Guild turrets
    const turretSlots = Math.min(10, 1 + Math.floor((guild.lv || 1) / 10));
    const dGt = {
      slots: turretSlots,
      fund: guild.turret_fund || 0,
      buy: 1000000 + (guild.turrets || []).length * 500000,
      list: (guild.turrets || []).map(t => ({
        id: t.id,
        lv: t.lv || 1,
        map: t.map || 0,
        zone: t.zone || 0,
        up: (t.lv || 1) < 10 ? (t.lv || 1) * 200000 : 0
      })),
      hist: guild.turret_history || []
    };

    // Guild dungeon
    const dungeonNext = guild.gdun_next || (Math.floor(Date.now() / 1000) + 3600 * 2);
    const dGdun = {
      lv: guild.lv || 1,
      ok: (guild.lv || 1) >= 20 ? 1 : 0,
      req: 20,
      hi: guild.lv || 1,
      next: dungeonNext,
      alive: guild.gdun_alive !== undefined ? guild.gdun_alive : 50,
      mvp: guild.gdun_mvp !== undefined ? guild.gdun_mvp : 1
    };

    // Egg slots
    const dGsol = {
      on: 1,
      slots: Math.min(5, Math.floor((guild.lv || 1) / 10)),
      list: guild.gsol || []
    };
    const dGlab = {
      on: 1,
      slots: Math.min(5, Math.floor((guild.lv || 1) / 15)),
      list: guild.glab || []
    };

    // Alliance invites
    const alInvCount = db.data.alliances.filter(a => a.invites && a.invites.includes(guild.id)).length;

    return res.json({
      ok: true,
      g: dG,
      me: dMe,
      members: members,
      res: dRes,
      ore: dOre,
      gt: dGt,
      gdun: dGdun,
      gsol: dGsol,
      glab: dGlab,
      alinv: alInvCount
    });
  }

  // 2. BROWSE Action
  if (action === 'browse') {
    const { q, page } = req.body;
    const pageIndex = parseInt(page) || 0;
    const queryStr = (q || '').trim().toLowerCase();

    let filtered = db.data.guilds;
    if (queryStr) {
      filtered = filtered.filter(g => g.name.toLowerCase().includes(queryStr));
    }

    const cdSecs = player.guild_left_at 
      ? Math.max(0, 24 * 3600 - (Math.floor(Date.now() / 1000) - player.guild_left_at))
      : 0;

    const list = filtered.slice(pageIndex * 10, (pageIndex + 1) * 10).map(g => {
      const leaderMember = g.members.find(m => m.role === 'leader');
      let leaderName = 'Không rõ';
      if (leaderMember) {
        const row = db.data.players.find(p => p.line_uid === leaderMember.uid);
        if (row) {
          leaderName = row.name;
          try {
            const parsed = JSON.parse(row.raw_data);
            if (parsed.display_name) leaderName = parsed.display_name;
          } catch(e) {}
        }
      }

      return {
        id: g.id,
        name: g.name,
        sh: g.sh || 0,
        co: g.co || 0,
        ic: g.ic || 0,
        lv: g.lv || 1,
        n: g.members.length,
        cap: 20 + (g.lv || 1) * 2,
        ld: leaderName
      };
    });

    return res.json({ ok: true, list: list, cd: cdSecs });
  }

  // 3. CREATE Action
  if (action === 'create') {
    const { name, sh, co, ic } = req.body;
    const gName = (name || '').trim();

    if (!gName) {
      return res.json({ ok: false, error: 'Tên bang hội không được bỏ trống!' });
    }

    if (player.guild_id) {
      return res.json({ ok: false, error: 'Bạn đã ở trong một bang hội khác!' });
    }

    const goldCost = 1000000;
    if ((player.gold || 0) < goldCost) {
      return res.json({ ok: false, error: 'Không đủ Vàng để lập bang! (Cần 1,000,000 Gold)' });
    }

    const exists = db.data.guilds.some(g => g.name.toLowerCase() === gName.toLowerCase());
    if (exists) {
      return res.json({ ok: false, error: 'Tên bang hội này đã tồn tại!' });
    }

    // Deduct gold
    player.gold -= goldCost;

    const newG = {
      id: Date.now(),
      name: gName,
      sh: parseInt(sh) || 0,
      co: parseInt(co) || 0,
      ic: parseInt(ic) || 0,
      lv: 1,
      exp: 0,
      notice: 'Chào mừng các bạn đến với bang hội!',
      leader_uid: player.line_uid,
      members: [
        { uid: player.line_uid, role: 'leader', ct: 0, joined_at: Math.floor(Date.now() / 1000) }
      ],
      turrets: [],
      turret_fund: 0,
      turret_history: [],
      ore: {
        lv: 1,
        have: { ore1: 0, ore2: 0, ore3: 0 },
        need: { ore1: 100, ore2: 50, ore3: 20 }
      },
      gsol: [],
      glab: [],
      gdun_next: Math.floor(Date.now() / 1000) + 3600 * 2,
      gdun_alive: 50,
      gdun_mvp: 1
    };

    db.data.guilds.push(newG);
    player.guild_id = newG.id;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 4. JOIN Action
  if (action === 'join') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    if (player.guild_id) {
      return res.json({ ok: false, error: 'Bạn đã ở trong bang hội!' });
    }

    const cdSecs = player.guild_left_at 
      ? Math.max(0, 24 * 3600 - (Math.floor(Date.now() / 1000) - player.guild_left_at))
      : 0;

    if (cdSecs > 0) {
      return res.json({ ok: false, error: `Vui lòng đợi ${Math.ceil(cdSecs / 3600)} giờ nữa trước khi gia nhập bang mới.` });
    }

    const targetG = db.data.guilds.find(g => g.id === targetGid);
    if (!targetG) {
      return res.json({ ok: false, error: 'Không tìm thấy bang hội chỉ định!' });
    }

    const maxCap = 20 + targetG.lv * 2;
    if (targetG.members.length >= maxCap) {
      return res.json({ ok: false, error: 'Bang hội này đã đầy!' });
    }

    targetG.members.push({
      uid: player.line_uid,
      role: 'member',
      ct: 0,
      joined_at: Math.floor(Date.now() / 1000)
    });

    player.guild_id = targetG.id;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 5. LEAVE Action
  if (action === 'leave') {
    if (!guild) {
      return res.json({ ok: false, error: 'Bạn không có bang hội!' });
    }

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (me.role === 'leader') {
      return res.json({ ok: false, error: 'Chủ bang không thể rời bang! Hãy chuyển chức chủ bang hoặc giải tán bang.' });
    }

    guild.members = guild.members.filter(m => m.uid !== player.line_uid);
    player.guild_id = 0;
    player.guild_left_at = Math.floor(Date.now() / 1000);

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 6. KICK Action
  if (action === 'kick') {
    const { uid } = req.body;
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || (me.role !== 'leader' && me.role !== 'officer')) {
      return res.json({ ok: false, error: 'Không có quyền trục xuất!' });
    }

    const target = guild.members.find(m => m.uid === uid);
    if (!target) {
      return res.json({ ok: false, error: 'Thành viên không tồn tại trong bang!' });
    }

    // Role validation
    if (me.role === 'officer' && target.role !== 'member') {
      return res.json({ ok: false, error: 'Phó bang chỉ được trục xuất thành viên thường!' });
    }
    if (target.role === 'leader') {
      return res.json({ ok: false, error: 'Không thể trục xuất chủ bang!' });
    }

    guild.members = guild.members.filter(m => m.uid !== uid);

    // Update target player object
    const targetRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(uid);
    if (targetRow) {
      try {
        let tObj = JSON.parse(targetRow.raw_data);
        tObj.guild_id = 0;
        tObj.guild_left_at = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(tObj), uid);
      } catch(e) {}
    }

    db.save();
    return res.json({ ok: true });
  }

  // 7. PROMOTE / DEMOTE / TRANSFER Actions
  if (action === 'promote' || action === 'demote' || action === 'transfer') {
    const { uid } = req.body;
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền thực hiện!' });
    }

    const target = guild.members.find(m => m.uid === uid);
    if (!target) {
      return res.json({ ok: false, error: 'Thành viên không tồn tại trong bang!' });
    }

    if (action === 'promote') {
      target.role = 'officer';
    } else if (action === 'demote') {
      target.role = 'member';
    } else if (action === 'transfer') {
      me.role = 'officer'; // demote current leader
      target.role = 'leader';
      guild.leader_uid = uid;
    }

    db.save();
    return res.json({ ok: true });
  }

  // 8. EMBLEM / NOTICE Actions
  if (action === 'emblem') {
    const { sh, co, ic } = req.body;
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới được đổi logo!' });
    }

    guild.sh = parseInt(sh) || 0;
    guild.co = parseInt(co) || 0;
    guild.ic = parseInt(ic) || 0;

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'notice') {
    const { text } = req.body;
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || (me.role !== 'leader' && me.role !== 'officer')) {
      return res.json({ ok: false, error: 'Không có quyền chỉnh sửa tuyên ngôn!' });
    }

    guild.notice = String(text || '').slice(0, 200);

    db.save();
    return res.json({ ok: true });
  }

  // 9. DISBAND Action
  if (action === 'disband') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới được giải tán!' });
    }

    // Reset all members
    guild.members.forEach(m => {
      const row = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(m.uid);
      if (row) {
        try {
          let tObj = JSON.parse(row.raw_data);
          tObj.guild_id = 0;
          tObj.guild_left_at = Math.floor(Date.now() / 1000);
          db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(tObj), m.uid);
        } catch(e) {}
      }
    });

    db.data.guilds = db.data.guilds.filter(g => g.id !== guild.id);
    db.save();

    return res.json({ ok: true });
  }

  // 10. DONATE Action (Gold)
  if (action === 'donate') {
    const { amt } = req.body;
    const amount = parseInt(amt) || 0;

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (amount <= 0) return res.json({ ok: false, error: 'Lượng đóng góp không hợp lệ!' });

    if ((player.gold || 0) < amount) {
      return res.json({ ok: false, error: 'Không đủ Vàng để đóng góp!' });
    }

    player.gold -= amount;

    const me = guild.members.find(m => m.uid === player.line_uid);
    me.ct = (me.ct || 0) + amount;
    guild.exp = (guild.exp || 0) + amount;

    // Check level up
    while (guild.lv < 100 && guild.exp >= guildExpNext(guild.lv)) {
      guild.exp -= guildExpNext(guild.lv);
      guild.lv = (guild.lv || 1) + 1;
    }

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 11. DONATE_RES Action (Resources)
  if (action === 'donate_res') {
    const { f, n } = req.body;
    const qty = parseInt(n) || 0;
    const key = f;

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (qty <= 0) return res.json({ ok: false, error: 'Lượng đóng góp không hợp lệ!' });

    const resourceConfig = {
      wood: 200, stone: 200, iron: 400, copper: 400, herb: 300,
      diamond_blue: 50000, diamond_red: 150000
    };

    const rate = resourceConfig[key];
    if (!rate) return res.json({ ok: false, error: 'Vật phẩm không hợp lệ!' });

    const playerQty = player[key] || 0;
    if (playerQty < qty) {
      return res.json({ ok: false, error: 'Không đủ số lượng vật phẩm!' });
    }

    // Verify daily limit
    const caps = { wood: 100, stone: 100, iron: 50, copper: 50, herb: 80, diamond_blue: 5, diamond_red: 2 };
    const cap = caps[key] || 0;

    const todayStr = new Date().toISOString().slice(0, 10);
    player.guild_donated_today = player.guild_donated_today || {};
    const used = player.guild_donated_today[key] || 0;
    const left = Math.max(0, cap - used);

    if (qty > left) {
      return res.json({ ok: false, error: 'Vượt quá giới hạn đóng góp hàng ngày!' });
    }

    // Deduct resource
    player[key] -= qty;
    player.guild_donated_today[key] = used + qty;

    const goldValue = qty * rate;
    const me = guild.members.find(m => m.uid === player.line_uid);
    me.ct = (me.ct || 0) + goldValue;
    guild.exp = (guild.exp || 0) + goldValue;

    // Level up check
    while (guild.lv < 100 && guild.exp >= guildExpNext(guild.lv)) {
      guild.exp -= guildExpNext(guild.lv);
      guild.lv = (guild.lv || 1) + 1;
    }

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 12. DONATE_ORE Action (Space Ores)
  if (action === 'donate_ore') {
    const { f, n } = req.body;
    const qty = parseInt(n) || 0;
    const key = f;

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (qty <= 0) return res.json({ ok: false, error: 'Lượng đóng góp không hợp lệ!' });

    const playerQty = player[key] || 0;
    if (playerQty < qty) {
      return res.json({ ok: false, error: 'Không đủ số lượng quặng!' });
    }

    // Deduct ore
    player[key] -= qty;

    guild.ore = guild.ore || { lv: 1, have: { ore1: 0, ore2: 0, ore3: 0 }, need: { ore1: 100, ore2: 50, ore3: 20 } };
    guild.ore.have = guild.ore.have || { ore1: 0, ore2: 0, ore3: 0 };
    guild.ore.have[key] = (guild.ore.have[key] || 0) + qty;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 13. CASTLE Actions
  if (action === 'castle') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    const targetG = db.data.guilds.find(g => g.id === targetGid);
    if (!targetG) return res.json({ ok: false, error: 'Không tìm thấy bang hội!' });

    const leaderMember = targetG.members.find(m => m.role === 'leader');
    let leaderName = 'Không rõ';
    if (leaderMember) {
      const row = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(leaderMember.uid);
      if (row) {
        leaderName = row.name;
        try {
          const parsed = JSON.parse(row.raw_data);
          if (parsed.display_name) leaderName = parsed.display_name;
        } catch(e) {}
      }
    }

    const members = targetG.members.map(m => {
      const r = db.data.players.find(p => p.line_uid === m.uid);
      let name = m.uid;
      let lv = 1;
      if (r) {
        name = r.name;
        try {
          const parsed = JSON.parse(r.raw_data);
          if (parsed.display_name) name = parsed.display_name;
          lv = parsed.lv || r.lv || 1;
        } catch(e) {}
      }
      return { role: m.role, name: name, lv: lv };
    });

    const gData = {
      id: targetG.id,
      name: targetG.name,
      lv: targetG.lv || 1,
      n: targetG.members.length,
      cap: 20 + (targetG.lv || 1) * 2,
      sh: targetG.sh || 0,
      co: targetG.co || 0,
      ic: targetG.ic || 0,
      notice: targetG.notice || ''
    };

    return res.json({
      ok: true,
      g: gData,
      members: members
    });
  }

  if (action === 'castle_enter') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    if (!player.guild_id) {
      return res.json({ ok: false, error: 'Bạn cần ở trong một bang hội để vào lâu đài!' });
    }

    player.castle_in = targetGid;
    player.home_return = { map: player.map || 1, x: player.x || 1125, y: player.y || 1125 };
    player.map = 11;
    player.x = 1125;
    player.y = 1125;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, map: 11, x: 1125, y: 1125 });
  }

  if (action === 'castle_exit') {
    const ret = player.home_return || { map: 1, x: 1125, y: 1125 };
    player.castle_in = 0;
    player.map = ret.map;
    player.x = ret.x;
    player.y = ret.y;
    player.home_return = null;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, map: player.map, x: player.x, y: player.y });
  }

  // 14. DUNGEON Actions
  if (action === 'gdun_enter') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (guild.lv < 20) return res.json({ ok: false, error: 'Yêu cầu bang hội đạt cấp 20!' });

    player.gdun_in = 1;
    player.home_return = { map: player.map || 1, x: player.x || 1125, y: player.y || 1125 };
    player.map = 12;
    player.x = 1125;
    player.y = 1125;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, map: 12, x: 1125, y: 1125 });
  }

  if (action === 'gdun_exit') {
    const ret = player.home_return || { map: 1, x: 1125, y: 1125 };
    player.gdun_in = 0;
    player.map = ret.map;
    player.x = ret.x;
    player.y = ret.y;
    player.home_return = null;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, map: player.map, x: player.x, y: player.y });
  }

  // 15. EGG Actions
  if (action === 'gegg_set') {
    const { kind, mid, mvp } = req.body;
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.role === 'leader');
    if (!me || me.uid !== player.line_uid) {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền đặt trứng!' });
    }

    // Decode player eggs
    let eggs = player.eggs;
    if (typeof eggs === 'string') {
      try {
        eggs = JSON.parse(eggs || '{}');
      } catch(e) {
        eggs = {};
      }
    }
    eggs = eggs || {};

    const eggObj = eggs[mid] || { n: 0, m: 0 };
    const isMvp = parseInt(mvp) === 1;

    if (isMvp) {
      if (eggObj.m <= 0) return res.json({ ok: false, error: 'Không có trứng MVP này!' });
      eggObj.m -= 1;
    } else {
      if (eggObj.n <= 0) return res.json({ ok: false, error: 'Không có trứng thường này!' });
      eggObj.n -= 1;
    }

    eggs[mid] = eggObj;
    player.eggs = eggs;

    // Push egg to guild slot
    const listKey = kind === 'war' ? 'gsol' : 'glab';
    guild[listKey] = guild[listKey] || [];
    guild[listKey].push({
      id: parseInt(mid),
      mvp: isMvp ? 1 : 0,
      ix: guild[listKey].length
    });

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, eggs: player.eggs });
  }

  if (action === 'gegg_del') {
    const { kind, ix } = req.body;
    const index = parseInt(ix);
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.role === 'leader');
    if (!me || me.uid !== player.line_uid) {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền gỡ trứng!' });
    }

    const listKey = kind === 'war' ? 'gsol' : 'glab';
    guild[listKey] = guild[listKey] || [];

    const egg = guild[listKey].find(e => e.ix === index);
    if (!egg) return res.json({ ok: false, error: 'Không tìm thấy trứng chỉ định!' });

    guild[listKey] = guild[listKey].filter(e => e.ix !== index);
    // Reindex remaining
    guild[listKey].forEach((e, i) => e.ix = i);

    // Return to inventory
    let eggs = player.eggs;
    if (typeof eggs === 'string') {
      try {
        eggs = JSON.parse(eggs || '{}');
      } catch(e) {
        eggs = {};
      }
    }
    eggs = eggs || {};

    const eggObj = eggs[egg.id] || { n: 0, m: 0 };
    if (egg.mvp) {
      eggObj.m += 1;
    } else {
      eggObj.n += 1;
    }
    eggs[egg.id] = eggObj;
    player.eggs = eggs;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true, eggs: player.eggs });
  }

  // 16. TURRET Actions
  if (action === 'turret_fund') {
    const { amt } = req.body;
    const amount = parseInt(amt) || 0;

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (amount <= 0) return res.json({ ok: false, error: 'Số tiền đóng góp không hợp lệ!' });

    if ((player.gold || 0) < amount) {
      return res.json({ ok: false, error: 'Không đủ Vàng để đóng góp!' });
    }

    player.gold -= amount;
    guild.turret_fund = (guild.turret_fund || 0) + amount;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  if (action === 'turret_buy') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.role === 'leader');
    if (!me || me.uid !== player.line_uid) {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền mua ụ súng!' });
    }

    const buyCost = 1000000 + (guild.turrets || []).length * 500000;
    if ((guild.turret_fund || 0) < buyCost) {
      return res.json({ ok: false, error: 'Không đủ quỹ bang để mua ụ súng!' });
    }

    guild.turret_fund -= buyCost;
    guild.turrets = guild.turrets || [];
    guild.turrets.push({
      id: Date.now(),
      lv: 1,
      map: 0,
      zone: 0
    });

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'turret_up') {
    const { tid } = req.body;
    const turretId = parseInt(tid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.role === 'leader');
    if (!me || me.uid !== player.line_uid) {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền nâng cấp ụ súng!' });
    }

    guild.turrets = guild.turrets || [];
    const turret = guild.turrets.find(t => t.id === turretId);
    if (!turret) return res.json({ ok: false, error: 'Không tìm thấy ụ súng chỉ định!' });

    if (turret.lv >= 10) return res.json({ ok: false, error: 'Ụ súng đã đạt cấp tối đa!' });

    const upCost = turret.lv * 200000;
    if ((guild.turret_fund || 0) < upCost) {
      return res.json({ ok: false, error: 'Không đủ quỹ bang để nâng cấp!' });
    }

    guild.turret_fund -= upCost;
    turret.lv += 1;

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'turret_move') {
    const { tid, map, zone } = req.body;
    const turretId = parseInt(tid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.role === 'leader');
    if (!me || me.uid !== player.line_uid) {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền di chuyển ụ súng!' });
    }

    guild.turrets = guild.turrets || [];
    const turret = guild.turrets.find(t => t.id === turretId);
    if (!turret) return res.json({ ok: false, error: 'Không tìm thấy ụ súng chỉ định!' });

    turret.map = parseInt(map) || 0;
    turret.zone = parseInt(zone) || 0;

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'turret_fund_res') {
    const { f, n } = req.body;
    const qty = parseInt(n) || 0;
    const key = f;

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (qty <= 0) return res.json({ ok: false, error: 'Số lượng không hợp lệ!' });

    const resourceConfig = {
      wood: 200, stone: 200, iron: 400, copper: 400, herb: 300,
      diamond_blue: 50000, diamond_red: 150000
    };

    const rate = resourceConfig[key];
    if (!rate) return res.json({ ok: false, error: 'Vật phẩm không hợp lệ!' });

    const playerQty = player[key] || 0;
    if (playerQty < qty) {
      return res.json({ ok: false, error: 'Không đủ số lượng vật phẩm!' });
    }

    // Deduct resource
    player[key] -= qty;

    const goldValue = qty * rate;
    guild.turret_fund = (guild.turret_fund || 0) + goldValue;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({ ok: true });
  }

  // 17. ALLIANCE Actions
  if (action === 'ally_info') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.members && a.members.includes(guild.id));
    const meInG = guild.members.find(m => m.uid === player.line_uid);
    const isGl = meInG && meInG.role === 'leader';

    const inv = db.data.alliances.filter(a => a.invites && a.invites.includes(guild.id)).map(a => {
      return {
        aid: a.id,
        name: a.name,
        n: a.members.length
      };
    });

    const needLv = 20;
    const maxCap = 3;

    if (!alliance) {
      return res.json({
        ok: true,
        a: null,
        inv: inv,
        cd: 0,
        war: false,
        gl: isGl,
        glv: guild.lv || 1,
        need: needLv,
        cap: maxCap,
        gid: guild.id
      });
    }

    const aData = {
      name: alliance.name,
      lead: alliance.lead,
      me: alliance.lead === guild.id
    };

    const memList = alliance.members.map(gid => {
      const g = db.data.guilds.find(x => x.id === gid);
      if (!g) return null;
      return {
        gid: g.id,
        name: g.name,
        sh: g.sh || 0,
        co: g.co || 0,
        ic: g.ic || 0,
        lv: g.lv || 1,
        n: g.members.length
      };
    }).filter(Boolean);

    const outList = aData.me ? (alliance.invites || []).map(gid => {
      const g = db.data.guilds.find(x => x.id === gid);
      if (!g) return null;
      return {
        gid: g.id,
        name: g.name
      };
    }).filter(Boolean) : [];

    return res.json({
      ok: true,
      a: aData,
      mem: memList,
      out: outList,
      cd: 0,
      war: false,
      gl: isGl,
      glv: guild.lv || 1,
      need: needLv,
      cap: maxCap,
      gid: guild.id
    });
  }

  if (action === 'ally_create') {
    const { name } = req.body;
    const aName = (name || '').trim();

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });
    if (!aName) return res.json({ ok: false, error: 'Tên liên minh không được bỏ trống!' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới có quyền lập liên minh!' });
    }

    if (guild.lv < 20) {
      return res.json({ ok: false, error: 'Bang hội phải đạt cấp 20 mới được lập liên minh!' });
    }

    const alreadyIn = db.data.alliances.some(a => a.members && a.members.includes(guild.id));
    if (alreadyIn) {
      return res.json({ ok: false, error: 'Bang hội của bạn đã ở trong liên minh!' });
    }

    const newA = {
      id: Date.now(),
      name: aName,
      lead: guild.id,
      members: [guild.id],
      invites: []
    };

    db.data.alliances.push(newA);
    db.save();

    return res.json({ ok: true });
  }

  if (action === 'ally_invite') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.lead === guild.id);
    if (!alliance) {
      return res.json({ ok: false, error: 'Chỉ bang hội làm chủ liên minh mới có quyền mời!' });
    }

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang hội mới có quyền mời!' });
    }

    if (alliance.members.length >= 3) {
      return res.json({ ok: false, error: 'Liên minh đã đủ số lượng thành viên!' });
    }

    const targetG = db.data.guilds.find(x => x.id === targetGid);
    if (!targetG) return res.json({ ok: false, error: 'Không tìm thấy bang hội mục tiêu!' });

    alliance.invites = alliance.invites || [];
    if (!alliance.invites.includes(targetGid)) {
      alliance.invites.push(targetGid);
    }

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_accept') {
    const { aid } = req.body;
    const allianceId = parseInt(aid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Chỉ chủ bang mới được chấp nhận!' });
    }

    const alliance = db.data.alliances.find(a => a.id === allianceId);
    if (!alliance) return res.json({ ok: false, error: 'Liên minh không tồn tại!' });

    if (!alliance.invites.includes(guild.id)) {
      return res.json({ ok: false, error: 'Không có lời mời từ liên minh này!' });
    }

    if (alliance.members.length >= 3) {
      return res.json({ ok: false, error: 'Liên minh đã đầy thành viên!' });
    }

    alliance.members.push(guild.id);
    alliance.invites = alliance.invites.filter(id => id !== guild.id);

    // Remove invitations of this guild from other alliances
    db.data.alliances.forEach(a => {
      a.invites = a.invites.filter(id => id !== guild.id);
    });

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_reject' || action === 'ally_cancel') {
    const { aid, gid } = req.body;

    if (action === 'ally_reject') {
      const allianceId = parseInt(aid);
      const alliance = db.data.alliances.find(a => a.id === allianceId);
      if (alliance) {
        alliance.invites = alliance.invites.filter(id => id !== guild.id);
      }
    } else {
      const targetGid = parseInt(gid);
      const alliance = db.data.alliances.find(a => a.lead === guild.id);
      if (alliance) {
        alliance.invites = alliance.invites.filter(id => id !== targetGid);
      }
    }

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_kick') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.lead === guild.id);
    if (!alliance) {
      return res.json({ ok: false, error: 'Không có quyền trục xuất bang hội!' });
    }

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Không có quyền!' });
    }

    alliance.members = alliance.members.filter(id => id !== targetGid);

    // Set cooldown for kicked guild
    const kickedG = db.data.guilds.find(x => x.id === targetGid);
    if (kickedG) {
      kickedG.ally_left_at = Math.floor(Date.now() / 1000);
    }

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_transfer') {
    const { gid } = req.body;
    const targetGid = parseInt(gid);

    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.lead === guild.id);
    if (!alliance) {
      return res.json({ ok: false, error: 'Không có quyền chuyển nhượng liên minh!' });
    }

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Không có quyền!' });
    }

    alliance.lead = targetGid;
    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_leave') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.members.includes(guild.id));
    if (!alliance) return res.json({ ok: false, error: 'Bang hội không ở trong liên minh!' });

    if (alliance.lead === guild.id && alliance.members.length > 1) {
      return res.json({ ok: false, error: 'Chủ liên minh không thể rời liên minh trừ khi chuyển chức hoặc giải tán liên minh!' });
    }

    alliance.members = alliance.members.filter(id => id !== guild.id);
    guild.ally_left_at = Math.floor(Date.now() / 1000);

    if (alliance.members.length === 0) {
      db.data.alliances = db.data.alliances.filter(a => a.id !== alliance.id);
    }

    db.save();
    return res.json({ ok: true });
  }

  if (action === 'ally_disband') {
    if (!guild) return res.json({ ok: false, error: 'Không có bang hội' });

    const alliance = db.data.alliances.find(a => a.lead === guild.id);
    if (!alliance) {
      return res.json({ ok: false, error: 'Chỉ chủ liên minh mới được giải tán!' });
    }

    const me = guild.members.find(m => m.uid === player.line_uid);
    if (!me || me.role !== 'leader') {
      return res.json({ ok: false, error: 'Không có quyền!' });
    }

    alliance.members.forEach(gid => {
      const g = db.data.guilds.find(x => x.id === gid);
      if (g) {
        g.ally_left_at = Math.floor(Date.now() / 1000);
      }
    });

    db.data.alliances = db.data.alliances.filter(a => a.id !== alliance.id);
    db.save();

    return res.json({ ok: true });
  }

  if (action === 'gwar_join') {
    if (!guild) {
      return res.json({ ok: false, error: 'Bạn cần ở trong một bang hội để tham gia công thành!' });
    }
    player.home_return = { map: player.map || 1, x: player.x || 1125, y: player.y || 1125 };
    player.map = 11; // Warp to Map 11 (Guild Castle / Battlefield)
    player.x = 1000;
    player.y = 1000;

    db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(player), line_uid);
    db.save();

    return res.json({
      ok: true,
      map: 11,
      x: 1000,
      y: 1000
    });
  }

  if (action === 'rank') {
    // Rank guilds by level descending, then exp descending
    const list = db.data.guilds.slice().sort((a, b) => {
      if ((b.lv || 1) !== (a.lv || 1)) {
        return (b.lv || 1) - (a.lv || 1);
      }
      return (b.exp || 0) - (a.exp || 0);
    }).map(g => {
      const leaderMember = g.members.find(m => m.role === 'leader');
      let leaderName = 'Không rõ';
      if (leaderMember) {
        const row = db.data.players.find(p => p.line_uid === leaderMember.uid);
        if (row) {
          leaderName = row.name;
          try {
            const parsed = JSON.parse(row.raw_data);
            if (parsed.display_name) leaderName = parsed.display_name;
          } catch(e) {}
        }
      }

      return {
        id: g.id,
        name: g.name,
        sh: g.sh || 0,
        co: g.co || 0,
        ic: g.ic || 0,
        lv: g.lv || 1,
        n: g.members.length,
        cap: 20 + (g.lv || 1) * 2,
        ld: leaderName,
        hon: g.honor_points || 0
      };
    });

    // Mock flag guild to be the first one in ranks (or none)
    const flagG = list[0] ? { id: list[0].id } : null;

    return res.json({
      ok: true,
      list: list,
      flag: flagG
    });
  }

  // Fallback response
  res.json({ ok: true, msg: 'Đang bảo trì.' });
});

module.exports = router;
