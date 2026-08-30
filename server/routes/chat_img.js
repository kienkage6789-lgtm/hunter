const express = require('express');
const fs = require('fs');
const { findChatImage } = require('../utils/image_storage');

const router = express.Router();

// Phục vụ dữ liệu ảnh chat an toàn (xhrpg_chat_img.php?id=<32_hex>)
router.get('*', (req, res) => {
  const urlMatch = typeof req.url === 'string' ? req.url.match(/id=([a-f0-9]+)/i) : null;
  const rawId = (req.query && req.query.id) || (req.params && req.params.id) || (urlMatch ? urlMatch[1] : '') || '';
  if (!rawId || typeof rawId !== 'string') {
    return res.status(400).send('Missing image ID');
  }

  const cleanId = rawId.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(cleanId)) {
    return res.status(400).send('Invalid image ID format');
  }

  const imageInfo = findChatImage(cleanId);
  if (!imageInfo) {
    return res.status(404).send('Image not found or expired');
  }

  res.setHeader('Content-Type', imageInfo.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', imageInfo.size);

  const stream = fs.createReadStream(imageInfo.filePath);
  stream.on('error', (err) => {
    console.error('Lỗi khi đọc file ảnh:', err);
    if (!res.headersSent) {
      res.status(500).send('Error reading image file');
    }
  });
  stream.pipe(res);
});

module.exports = router;
