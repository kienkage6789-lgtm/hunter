const express = require('express');
const db = require('../db/queries');
const { acquireLock } = require('../utils/lock');

const router = express.Router();

// ── In-Memory Anti-Spam & Duplicate Trackers ──
// rateLimits: line_uid -> [timestamps of recent sends]
// recentMessages: line_uid -> { text, room, target, ts }
const rateLimits = new Map();
const recentMessages = new Map();

// Deadlock-free two-user locking: luôn sắp xếp UIDs theo thứ tự từ điển
async function acquireTwoLocks(uidA, uidB) {
  if (!uidA && !uidB) return () => {};
  if (!uidA) return await acquireLock(uidB);
  if (!uidB || uidA === uidB) return await acquireLock(uidA);

  const [first, second] = [uidA, uidB].sort();
  const rel1 = await acquireLock(first);
  const rel2 = await acquireLock(second);

  return () => {
    try { rel2(); } catch (e) {}
    try { rel1(); } catch (e) {}
  };
}

// Thực thi transaction nguyên tử (Atomic Transaction): snapshot toàn bộ db.data, commit khi mọi bước thành công, rollback nếu có lỗi
function executeAtomicTransaction(workFn) {
  db.load();
  const snapshot = JSON.parse(JSON.stringify(db.data));
  try {
    const result = workFn(db.data);
    if (!result || result.ok === false) {
      db.data = snapshot;
      return result || { ok: false, error: 'Thao tác thất bại' };
    }
    db.save();
    return result;
  } catch (err) {
    db.data = snapshot;
    try {
      db.save();
    } catch (saveErr) {
      console.error('[Chat Rollback] Lỗi khi lưu rollback snapshot:', saveErr);
    }
    return { ok: false, error: 'Lỗi máy chủ trò chuyện: ' + (err.message || 'Lỗi không xác định') };
  }
}

// Làm sạch nội dung tin nhắn (Sanitize Text Content)
function sanitizeChatMessage(raw) {
  if (typeof raw !== 'string') return '';
  // Loại bỏ các ký tự điều khiển nguy hiểm nhưng giữ khoảng trắng và các ký tự UTF-8/Emoji hợp lệ
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 200);
}

// Cắt tỉa lịch sử chat để tránh phình to database (Prune history)
function pruneChatHistory(dbData) {
  if (!Array.isArray(dbData.chat_messages)) return;
  // Giữ tối đa 1000 tin nhắn tổng cộng trong cơ sở dữ liệu
  if (dbData.chat_messages.length > 1000) {
    dbData.chat_messages = dbData.chat_messages.slice(-1000);
  }
}

// ── Router chính Chat ──
router.post('/', async (req, res) => {
  const { line_uid, session_token, action } = req.body;
  if (!line_uid || !session_token) {
    return res.json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
  }

  db.load();
  const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
  if (!userRow) {
    return res.json({ ok: false, error: 'Unauthorized: Invalid session_token' });
  }

  const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(line_uid);
  if (!pRow) {
    return res.json({ ok: false, error: 'Player not found' });
  }
  let playerObj = {};
  try {
    playerObj = JSON.parse(pRow.raw_data || '{}');
  } catch (e) {
    playerObj = {};
  }

  // 1. Tải danh sách tin nhắn (action === 'fetch')
  if (action === 'fetch') {
    const room = (req.body.room || '').trim();
    const withUid = (req.body.with || '').trim();

    if (!Array.isArray(db.data.chat_messages)) {
      db.data.chat_messages = [];
    }

    // A. Kênh Guild (Bang hội)
    if (room === 'guild') {
      const guildId = playerObj.guild_id || pRow.guild_id;
      if (!guildId) {
        return res.json({ ok: false, error: 'no_guild', msg: 'Bạn phải ở trong bang hội mới có thể xem chat bang!' });
      }

      const guildMsgs = db.data.chat_messages
        .filter(m => m && m.room === 'guild' && m.guild_id === guildId)
        .slice(-50);

      return res.json({
        ok: true,
        msgs: guildMsgs,
        me: line_uid
      });
    }

    // B. Kênh Tin nhắn riêng (DM)
    if (withUid) {
      const release = await acquireLock(line_uid);
      try {
        let dmMsgs = [];
        executeAtomicTransaction((dbData) => {
          if (!Array.isArray(dbData.chat_messages)) dbData.chat_messages = [];

          // Đánh dấu các tin nhắn gửi từ withUid tới line_uid là đã đọc
          let hasUnread = false;
          for (const m of dbData.chat_messages) {
            if (m && m.room === 'dm' && m.u === withUid && m.to_uid === line_uid && !m.is_read) {
              m.is_read = true;
              hasUnread = true;
            }
          }

          dmMsgs = dbData.chat_messages
            .filter(m => m && m.room === 'dm' && ((m.u === line_uid && m.to_uid === withUid) || (m.u === withUid && m.to_uid === line_uid)))
            .slice(-50);

          return { ok: true };
        });

        return res.json({
          ok: true,
          msgs: dmMsgs,
          me: line_uid
        });
      } finally {
        release();
      }
    }

    // C. Kênh Toàn cầu (Global)
    const globalMsgs = db.data.chat_messages
      .filter(m => m && (!m.room || m.room === 'global'))
      .slice(-50);

    return res.json({
      ok: true,
      msgs: globalMsgs,
      me: line_uid
    });
  }

  // 2. Danh sách các cuộc trò chuyện DM gần đây (action === 'dms')
  if (action === 'dms') {
    if (!Array.isArray(db.data.chat_messages)) {
      db.data.chat_messages = [];
    }

    // Lọc các tin nhắn DM liên quan tới line_uid
    const myDms = db.data.chat_messages.filter(m => m && m.room === 'dm' && (m.u === line_uid || m.to_uid === line_uid));
    const convMap = new Map(); // partnerUid -> conversation detail

    for (const m of myDms) {
      const isSender = m.u === line_uid;
      const partnerUid = isSender ? m.to_uid : m.u;
      if (!partnerUid) continue;

      let conv = convMap.get(partnerUid);
      if (!conv) {
        conv = {
          uid: partnerUid,
          name: isSender ? (m.to_name || 'Người chơi') : (m.n || 'Người chơi'),
          cc: isSender ? (m.to_cc || 'VN') : (m.cc || 'VN'),
          vp: isSender ? (m.to_vp || 0) : (m.vp || 0),
          gm: isSender ? !!m.to_gm : !!m.gm,
          cl: isSender ? !!m.to_cl : !!m.cl,
          last: m.m || (m.img ? '📷 [Hình ảnh]' : ''),
          ts: m.ts || Math.floor(Date.now() / 1000),
          n: 0
        };
        convMap.set(partnerUid, conv);
      }

      // Cập nhật tin nhắn mới nhất
      if (m.ts >= conv.ts) {
        conv.last = m.m || (m.img ? '📷 [Hình ảnh]' : '');
        conv.ts = m.ts;
      }

      // Đếm số lượng tin nhắn chưa đọc
      if (!isSender && !m.is_read) {
        conv.n = (conv.n || 0) + 1;
      }
    }

    // Bổ sung thông tin người chơi mới nhất từ DB nếu có
    const allPlayers = db.data.players || [];
    const dmsList = Array.from(convMap.values()).map(conv => {
      const partnerRow = allPlayers.find(p => p.line_uid === conv.uid);
      if (partnerRow) {
        let pObj = {};
        try { pObj = JSON.parse(partnerRow.raw_data || '{}'); } catch(e) {}
        const pUser = (db.data.users || []).find(u => u.line_uid === conv.uid) || {};
        conv.name = partnerRow.name || conv.name;
        conv.cc = pObj.country || pObj.last_cc || conv.cc;
        conv.vp = pObj.vip_lv || 0;
        conv.gm = pUser.role === 'admin' || pUser.role === 'gm';
        conv.cl = !!pUser.is_cl;
      }
      return conv;
    });

    dmsList.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return res.json({
      ok: true,
      dms: dmsList
    });
  }

  // 3. Gửi tin nhắn (action === 'send')
  if (action === 'send') {
    const rawMsg = req.body.message || req.body.text || '';
    const cleanMsg = sanitizeChatMessage(rawMsg);
    const rawImg = typeof req.body.img === 'string' ? req.body.img.trim() : '';
    const imgId = /^[a-f0-9]{32}$/.test(rawImg) ? rawImg : null;
    const room = (req.body.room || '').trim();
    const toUid = (req.body.to || req.body.to_uid || '').trim();
    const trData = (req.body.tr && typeof req.body.tr === 'object') ? req.body.tr : null;

    if (!cleanMsg && !imgId) {
      return res.json({ ok: false, error: 'empty_message', msg: 'Vui lòng nhập nội dung tin nhắn hoặc đính kèm ảnh!' });
    }

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    // Duplicate Suppression (Chặn tin nhắn trùng lặp trong 15s)
    const recent = recentMessages.get(line_uid);
    const targetKey = toUid || room || 'global';
    if (recent && recent.text === cleanMsg && recent.target === targetKey && (nowMs - recent.ts) < 15000) {
      return res.json({
        ok: true,
        dup: true,
        msg: 'Tin nhắn trùng lặp với tin vừa gửi trong phòng này — vui lòng đợi hoặc đổi nội dung.'
      });
    }

    // Rate-limit chống spam (Tối đa 10 tin nhắn trong 3 giây)
    let sends = rateLimits.get(line_uid) || [];
    sends = sends.filter(t => nowMs - t < 3000);
    if (sends.length >= 10) {
      return res.json({ ok: false, error: 'rate_limit', msg: 'Bạn đang gửi tin nhắn quá nhanh, vui lòng chờ giây lát!' });
    }
    sends.push(nowMs);
    rateLimits.set(line_uid, sends);

    // Kiểm tra gửi vào Bang hội
    let guildId = null;
    if (room === 'guild') {
      guildId = playerObj.guild_id || pRow.guild_id;
      if (!guildId) {
        return res.json({ ok: false, error: 'no_guild', msg: 'Bạn phải ở trong bang hội mới có thể chat bang!' });
      }
    }

    // Kiểm tra gửi DM
    let recipientPlayer = null;
    let recipientUser = null;
    let recipientObj = {};
    if (toUid) {
      if (toUid === line_uid) {
        return res.json({ ok: false, error: 'self_dm', msg: 'Không thể tự gửi tin nhắn riêng cho chính mình!' });
      }
      recipientPlayer = (db.data.players || []).find(p => p.line_uid === toUid);
      if (!recipientPlayer) {
        return res.json({ ok: false, error: 'not_found', msg: 'Người nhận không tồn tại hoặc offline!' });
      }
      recipientUser = (db.data.users || []).find(u => u.line_uid === toUid) || {};
      try { recipientObj = JSON.parse(recipientPlayer.raw_data || '{}'); } catch(e) {}
    }

    const release = toUid ? await acquireTwoLocks(line_uid, toUid) : await acquireLock(line_uid);
    try {
      const txRes = executeAtomicTransaction((dbData) => {
        if (!Array.isArray(dbData.chat_messages)) {
          dbData.chat_messages = [];
        }

        const nextId = (dbData.chat_messages.length > 0 ? Math.max(...dbData.chat_messages.map(x => x.id || 0)) : 0) + 1;

        const isGm = userRow.role === 'admin' || userRow.role === 'gm';
        const isCl = !!userRow.is_cl;

        const newMsg = {
          id: nextId,
          room: toUid ? 'dm' : (room === 'guild' ? 'guild' : 'global'),
          guild_id: guildId || null,
          u: line_uid,
          n: pRow.name || 'Người chơi',
          to_uid: toUid || null,
          to_name: recipientPlayer ? recipientPlayer.name : null,
          to_cc: recipientObj ? (recipientObj.country || recipientObj.last_cc || 'VN') : null,
          to_vp: recipientObj ? (recipientObj.vip_lv || 0) : null,
          to_gm: recipientUser ? (recipientUser.role === 'admin' || recipientUser.role === 'gm') : false,
          to_cl: recipientUser ? !!recipientUser.is_cl : false,
          m: cleanMsg,
          ts: nowSec,
          cc: playerObj.country || playerObj.last_cc || 'VN',
          lv: playerObj.lv || pRow.lv || 1,
          rg: playerObj.rag_lv || 0,
          vp: playerObj.vip_lv || 0,
          gd: playerObj.guild_tag || '',
          mp: playerObj.map || pRow.map || 1,
          gm: isGm,
          cl: isCl,
          img: imgId,
          tr: trData,
          is_read: false
        };

        dbData.chat_messages.push(newMsg);
        pruneChatHistory(dbData);

        return { ok: true };
      });

      if (!txRes || !txRes.ok) {
        return res.json(txRes || { ok: false, error: 'Lỗi gửi tin nhắn' });
      }

      // Lưu tin nhắn gần nhất để chống duplicate
      recentMessages.set(line_uid, {
        text: cleanMsg,
        target: targetKey,
        ts: nowMs
      });

      return res.json({ ok: true });
    } finally {
      release();
    }
  }

  // 4. Báo cáo hình ảnh (action === 'report_img')
  if (action === 'report_img') {
    const rawImg = typeof req.body.img === 'string' ? req.body.img.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{32}$/.test(rawImg)) {
      return res.json({ ok: false, error: 'invalid_image', msg: 'Mã hình ảnh không hợp lệ!' });
    }

    const { findChatImage } = require('../utils/image_storage');
    const imageInfo = findChatImage(rawImg);
    if (!imageInfo) {
      return res.json({
        ok: false,
        error: 'image_not_found',
        msg: 'Hình ảnh không tồn tại hoặc đã bị xóa.'
      });
    }

    if (!db.data.reported_images) db.data.reported_images = [];
    db.data.reported_images.push({
      img: rawImg,
      reporter_uid: line_uid,
      ts: Math.floor(Date.now() / 1000)
    });
    db.save();

    return res.json({
      ok: true,
      msg: 'Đã tiếp nhận báo cáo hình ảnh vi phạm!'
    });
  }

  return res.json({ ok: false, error: 'Unknown chat action' });
});

module.exports = router;
