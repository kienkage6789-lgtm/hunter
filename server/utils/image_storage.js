const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHAT_IMAGE_DIR = path.resolve(__dirname, '../../data/chat_images');
const MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB

// Đảm bảo thư mục lưu trữ ảnh tồn tại
if (!fs.existsSync(CHAT_IMAGE_DIR)) {
  fs.mkdirSync(CHAT_IMAGE_DIR, { recursive: true });
}

/**
 * Kiểm tra magic bytes của buffer để xác thực MIME type thật sự
 * @param {Buffer} buffer
 * @returns {{ mimeType: string, ext: string } | null}
 */
function detectImageMime(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mimeType: 'image/jpeg', ext: '.jpg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { mimeType: 'image/png', ext: '.png' };
  }

  // 3. WebP: RIFF .... WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: '.webp' };
  }

  return null;
}

/**
 * Phân tích multipart/form-data trực tiếp từ request stream
 * @param {import('express').Request} req
 * @returns {Promise<{ fields: Record<string, string>, file: { buffer: Buffer, mimeType?: string, fileName?: string } | null }>}
 */
function parseMultipartRequest(req, maxLimit = MAX_IMAGE_SIZE + (1024 * 64)) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';

    // Nếu request là JSON hoặc x-www-form-urlencoded (đã được Express body-parser nạp)
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      const fields = { ...req.body };
      let fileObj = null;

      if (req.body.image) {
        if (Buffer.isBuffer(req.body.image)) {
          fileObj = { buffer: req.body.image };
        } else if (typeof req.body.image === 'string') {
          // Xử lý base64 data URI hoặc raw base64
          const base64Match = req.body.image.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
          const rawBase64 = base64Match ? base64Match[1] : req.body.image;
          try {
            const buf = Buffer.from(rawBase64, 'base64');
            fileObj = { buffer: buf };
          } catch (e) {}
        }
      }
      return resolve({ fields, file: fileObj });
    }

    // Nếu là multipart/form-data
    if (!contentType.includes('multipart/form-data')) {
      return resolve({ fields: {}, file: null });
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      return resolve({ fields: {}, file: null });
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const boundaryBuffer = Buffer.from('--' + boundary);

    const chunks = [];
    let totalLength = 0;

    req.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > maxLimit) {
        req.destroy();
        return reject(new Error('File size exceeds server limit (3MB)'));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      const fields = {};
      let fileBuffer = null;
      let fileMime = null;
      let fileName = null;

      let startPos = 0;
      while (startPos < bodyBuffer.length) {
        const boundaryIdx = bodyBuffer.indexOf(boundaryBuffer, startPos);
        if (boundaryIdx === -1) break;

        const nextBoundaryIdx = bodyBuffer.indexOf(boundaryBuffer, boundaryIdx + boundaryBuffer.length);
        if (nextBoundaryIdx === -1) break;

        const partBuffer = bodyBuffer.subarray(boundaryIdx + boundaryBuffer.length, nextBoundaryIdx);
        startPos = nextBoundaryIdx;

        const headerEndIdx = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEndIdx === -1) continue;

        const headerStr = partBuffer.subarray(0, headerEndIdx).toString('utf8');
        let bodyData = partBuffer.subarray(headerEndIdx + 4);
        if (bodyData.length >= 2 && bodyData[bodyData.length - 2] === 0x0D && bodyData[bodyData.length - 1] === 0x0A) {
          bodyData = bodyData.subarray(0, bodyData.length - 2);
        }

        const nameMatch = headerStr.match(/name="([^"]+)"/i);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
        const contentTypeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

        if (nameMatch) {
          const fieldName = nameMatch[1];
          if (filenameMatch) {
            fileName = filenameMatch[1];
            fileMime = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
            fileBuffer = bodyData;
          } else {
            fields[fieldName] = bodyData.toString('utf8').trim();
          }
        }
      }

      resolve({
        fields,
        file: fileBuffer ? { buffer: fileBuffer, mimeType: fileMime, fileName } : null
      });
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Lưu ảnh nguyên tử (atomic write) vào thư mục data/chat_images
 * @param {Buffer} buffer
 * @param {string} ext
 * @returns {{ ok: boolean, imgId?: string, filePath?: string, error?: string }}
 */
function saveChatImageAtomic(buffer, ext) {
  const imgId = crypto.randomBytes(16).toString('hex').toLowerCase();
  const finalFilename = `${imgId}${ext}`;
  const finalPath = path.join(CHAT_IMAGE_DIR, finalFilename);
  const tempFilename = `temp_${imgId}_${Date.now()}.tmp`;
  const tempPath = path.join(CHAT_IMAGE_DIR, tempFilename);

  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, finalPath);
    return { ok: true, imgId, filePath: finalPath };
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Tìm kiếm file ảnh theo 32-char hex ID an toàn chống path traversal
 * @param {string} rawId
 * @returns {{ filePath: string, mimeType: string, ext: string, size: number } | null}
 */
function findChatImage(rawId) {
  if (!rawId || typeof rawId !== 'string') return null;
  const cleanId = rawId.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(cleanId)) return null;

  const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of validExts) {
    const candidatePath = path.join(CHAT_IMAGE_DIR, `${cleanId}${ext}`);
    if (fs.existsSync(candidatePath)) {
      try {
        const stats = fs.statSync(candidatePath);
        if (!stats.isFile()) continue;

        // Đọc header để xác thực lại MIME type an toàn
        const fd = fs.openSync(candidatePath, 'r');
        const headerBuf = Buffer.alloc(16);
        fs.readSync(fd, headerBuf, 0, 16, 0);
        fs.closeSync(fd);

        const detected = detectImageMime(headerBuf);
        const mimeType = detected ? detected.mimeType : (ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg'));

        return {
          filePath: candidatePath,
          mimeType: mimeType,
          ext: ext,
          size: stats.size
        };
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

module.exports = {
  CHAT_IMAGE_DIR,
  MAX_IMAGE_SIZE,
  detectImageMime,
  parseMultipartRequest,
  saveChatImageAtomic,
  findChatImage
};

