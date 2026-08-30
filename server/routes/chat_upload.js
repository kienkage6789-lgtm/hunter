const express = require('express');
const db = require('../db/queries');
const {
  MAX_IMAGE_SIZE,
  detectImageMime,
  parseMultipartRequest,
  saveChatImageAtomic
} = require('../utils/image_storage');

const router = express.Router();

// Xử lý tải ảnh chat lên máy chủ (xhrpg_chat_upload.php)
router.post('/', async (req, res) => {
  try {
    const { fields, file } = await parseMultipartRequest(req, MAX_IMAGE_SIZE + 1024);

    const line_uid = (fields.line_uid || '').trim();
    const session_token = (fields.session_token || '').trim();

    if (!line_uid || !session_token) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Missing line_uid or session_token' });
    }

    db.load();
    const userRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(line_uid, session_token);
    if (!userRow) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid session_token' });
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing image file' });
    }

    if (file.buffer.length > MAX_IMAGE_SIZE) {
      return res.status(400).json({ ok: false, error: 'Dung lượng ảnh vượt quá giới hạn 3MB' });
    }

    // Xác thực định dạng ảnh qua Magic Bytes thực tế
    const detected = detectImageMime(file.buffer);
    if (!detected) {
      return res.status(400).json({
        ok: false,
        error: 'Định dạng ảnh không hợp lệ. Máy chủ chỉ chấp nhận ảnh JPEG, PNG hoặc WebP thực sự.'
      });
    }

    // Ghi file nguyên tử vào disk
    const saveResult = saveChatImageAtomic(file.buffer, detected.ext);
    if (!saveResult.ok || !saveResult.imgId) {
      return res.status(500).json({ ok: false, error: 'Lỗi khi lưu trữ ảnh lên hệ thống' });
    }

    return res.json({
      ok: true,
      img: saveResult.imgId
    });
  } catch (err) {
    if (err.message && err.message.includes('exceeds server limit')) {
      return res.status(400).json({ ok: false, error: 'Dung lượng ảnh vượt quá giới hạn 3MB' });
    }
    console.error('Lỗi khi tải ảnh chat:', err);
    return res.status(500).json({ ok: false, error: 'Lỗi xử lý tải ảnh: ' + (err.message || 'Lỗi hệ thống') });
  }
});

module.exports = router;
