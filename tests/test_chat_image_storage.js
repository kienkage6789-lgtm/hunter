const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const chatUploadRoute = require('../server/routes/chat_upload');
const chatImgRoute = require('../server/routes/chat_img');
const chatRoute = require('../server/routes/chat');
const { CHAT_IMAGE_DIR } = require('../server/utils/image_storage');

console.log('🧪 Bắt đầu kiểm thử toàn diện Chat Image Storage (TASK-027)...');

function cleanupTestRecords(uids = [], createdImgIds = []) {
  try {
    db.load();
    if (db.data) {
      const isTestUid = (uid) => {
        if (!uid) return false;
        if (uids.includes(uid)) return true;
        return uid.startsWith('test_img_') || uid.startsWith('test_alice_') || uid.startsWith('test_bob_');
      };

      if (Array.isArray(db.data.users)) {
        db.data.users = db.data.users.filter(u => !isTestUid(u.line_uid));
      }
      if (Array.isArray(db.data.players)) {
        db.data.players = db.data.players.filter(p => !isTestUid(p.line_uid));
      }
      if (Array.isArray(db.data.reported_images)) {
        db.data.reported_images = db.data.reported_images.filter(r => !createdImgIds.includes(r.img) && !isTestUid(r.reporter_uid));
      }
      db.save();
    }

    // Xóa các file ảnh test đã tạo ra trong thư mục data/chat_images
    if (fs.existsSync(CHAT_IMAGE_DIR)) {
      const files = fs.readdirSync(CHAT_IMAGE_DIR);
      for (const f of files) {
        for (const id of createdImgIds) {
          if (f.startsWith(id) || f.startsWith('temp_')) {
            try { fs.unlinkSync(path.join(CHAT_IMAGE_DIR, f)); } catch (e) {}
          }
        }
      }
    }
  } catch (err) {
    console.error('Lỗi khi cleanup database/images:', err);
  }
}

function callUpload(router, { fields, fileBuffer, fileName, contentTypeHeader }) {
  return new Promise((resolve) => {
    const boundary = '----WebKitFormBoundaryTest' + Date.now();
    const parts = [];

    for (const [k, v] of Object.entries(fields || {})) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }

    if (fileBuffer) {
      const mime = contentTypeHeader || 'application/octet-stream';
      const name = fileName || 'upload.png';
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`));
      parts.push(fileBuffer);
      parts.push(Buffer.from('\r\n'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const fullBody = Buffer.concat(parts);

    const { PassThrough } = require('stream');
    const reqStream = new PassThrough();
    reqStream.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(fullBody.length)
    };
    reqStream.method = 'POST';
    reqStream.url = '/';

    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => resolve({ status: statusCode, body: data }),
      send: (data) => resolve({ status: statusCode, body: data })
    };

    router.handle(reqStream, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Route not handled' } });
    });

    reqStream.end(fullBody);
  });
}

function callServe(router, query) {
  return new Promise((resolve) => {
    const queryString = query && query.id ? `?id=${encodeURIComponent(query.id)}` : '';
    const req = {
      method: 'GET',
      url: '/' + queryString,
      query: query || {},
      params: {},
      headers: {}
    };

    const { PassThrough } = require('stream');
    const resStream = new PassThrough();
    let statusCode = 200;
    const responseHeaders = {};
    const chunks = [];

    resStream.status = (code) => {
      statusCode = code;
      return resStream;
    };
    resStream.setHeader = (k, v) => {
      responseHeaders[k.toLowerCase()] = v;
    };
    resStream.send = (data) => {
      resolve({ status: statusCode, headers: responseHeaders, body: data });
    };

    resStream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    resStream.on('end', () => {
      const full = Buffer.concat(chunks);
      resolve({ status: statusCode, headers: responseHeaders, body: full });
    });

    router.handle(req, resStream, () => {
      resolve({ status: statusCode, headers: responseHeaders, body: 'Not Handled' });
    });
  });
}

function callChat(router, body) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      url: '/',
      body: body || {},
      headers: {}
    };
    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => resolve({ status: statusCode, body: data })
    };
    router.handle(req, res, () => {
      resolve({ status: statusCode, body: { ok: false, error: 'Not Handled' } });
    });
  });
}

async function runTests() {
  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const aliceUid = 'test_img_alice_' + uniqueSuffix;
  const bobUid = 'test_img_bob_' + uniqueSuffix;
  const aliceToken = 'tok_alice_' + uniqueSuffix;
  const bobToken = 'tok_bob_' + uniqueSuffix;
  const testUids = [aliceUid, bobUid];
  const createdImgIds = [];

  cleanupTestRecords(testUids, createdImgIds);

  try {
    // 1. Tạo test users & players
    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      aliceUid, 'alice_' + uniqueSuffix, 'hash', aliceToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      aliceUid, 'Alice Image', JSON.stringify({ line_uid: aliceUid, name: 'Alice Image', lv: 20 })
    );

    db.prepare('INSERT INTO users (line_uid, username, password_hash, session_token) VALUES (?, ?, ?, ?)').run(
      bobUid, 'bob_' + uniqueSuffix, 'hash', bobToken
    );
    db.prepare('INSERT INTO players (line_uid, name, raw_data) VALUES (?, ?, ?)').run(
      bobUid, 'Bob Image', JSON.stringify({ line_uid: bobUid, name: 'Bob Image', lv: 22 })
    );

    console.log('\n========================================');
    console.log('PHẦN 1: KIỂM THỬ UPLOAD VÀ SERVE ĐÚNG ĐỊNH DẠNG');
    console.log('========================================');

    // 1.1 Upload PNG hợp lệ
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89
    ]);
    const resPngUpload = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: aliceToken },
      fileBuffer: validPngBuffer,
      fileName: 'avatar.png',
      contentTypeHeader: 'image/png'
    });
    assert.strictEqual(resPngUpload.status, 200);
    assert.strictEqual(resPngUpload.body.ok, true);
    assert.ok(/^[a-f0-9]{32}$/.test(resPngUpload.body.img), 'Mã ảnh phải là 32-char lowercase hex');
    const pngImgId = resPngUpload.body.img;
    createdImgIds.push(pngImgId);

    // Serve lại PNG
    const resPngServe = await callServe(chatImgRoute, { id: pngImgId });
    assert.strictEqual(resPngServe.status, 200);
    assert.strictEqual(resPngServe.headers['content-type'], 'image/png');
    assert.strictEqual(resPngServe.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(resPngServe.headers['content-disposition'], 'inline');
    assert.strictEqual(Buffer.compare(resPngServe.body, validPngBuffer), 0, 'Bytes phục vụ phải khớp 100% với file đã upload');
    console.log('  ✓ Upload & Serve PNG thành công tuyệt đối.');

    // 1.2 Upload JPEG hợp lệ
    const validJpgBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xFF, 0xD9
    ]);
    const resJpgUpload = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: aliceToken },
      fileBuffer: validJpgBuffer,
      fileName: 'photo.jpg',
      contentTypeHeader: 'image/jpeg'
    });
    assert.strictEqual(resJpgUpload.status, 200);
    assert.strictEqual(resJpgUpload.body.ok, true);
    const jpgImgId = resJpgUpload.body.img;
    createdImgIds.push(jpgImgId);

    const resJpgServe = await callServe(chatImgRoute, { id: jpgImgId });
    assert.strictEqual(resJpgServe.status, 200);
    assert.strictEqual(resJpgServe.headers['content-type'], 'image/jpeg');
    assert.strictEqual(Buffer.compare(resJpgServe.body, validJpgBuffer), 0);
    console.log('  ✓ Upload & Serve JPEG thành công.');

    // 1.3 Upload WebP hợp lệ
    const validWebpBuffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 ', 'ascii'),
      Buffer.from([0x14, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00])
    ]);
    const resWebpUpload = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: aliceToken },
      fileBuffer: validWebpBuffer,
      fileName: 'sticker.webp',
      contentTypeHeader: 'image/webp'
    });
    assert.strictEqual(resWebpUpload.status, 200);
    assert.strictEqual(resWebpUpload.body.ok, true);
    const webpImgId = resWebpUpload.body.img;
    createdImgIds.push(webpImgId);

    const resWebpServe = await callServe(chatImgRoute, { id: webpImgId });
    assert.strictEqual(resWebpServe.status, 200);
    assert.strictEqual(resWebpServe.headers['content-type'], 'image/webp');
    assert.strictEqual(Buffer.compare(resWebpServe.body, validWebpBuffer), 0);
    console.log('  ✓ Upload & Serve WebP thành công.');

    console.log('\n========================================');
    console.log('PHẦN 2: KIỂM THỬ XÁC THỰC BẢO MẬT PHIÊN UPLOAD');
    console.log('========================================');

    // 2.1 Thiếu token
    const resNoTok = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid },
      fileBuffer: validPngBuffer
    });
    assert.strictEqual(resNoTok.status, 401);
    assert.strictEqual(resNoTok.body.ok, false);

    // 2.2 Token sai
    const resBadTok = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: 'fake_token' },
      fileBuffer: validPngBuffer
    });
    assert.strictEqual(resBadTok.status, 401);
    assert.strictEqual(resBadTok.body.ok, false);

    // 2.3 Token user khác (Alice UID + Bob Token)
    const resStolenTok = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: bobToken },
      fileBuffer: validPngBuffer
    });
    assert.strictEqual(resStolenTok.status, 401);
    assert.strictEqual(resStolenTok.body.ok, false);

    console.log('  ✓ Toàn bộ các vi phạm xác thực upload đều bị chặn 401.');

    console.log('\n========================================');
    console.log('PHẦN 3: KIỂM THỬ BẢO VỆ MIME & MAGIC BYTES');
    console.log('========================================');

    // 3.1 File text giả mạo extension .png / Content-Type image/png
    const fakeTextPng = Buffer.from('<script>alert("xss")</script>');
    const resFakeMime = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: aliceToken },
      fileBuffer: fakeTextPng,
      fileName: 'malicious.png',
      contentTypeHeader: 'image/png'
    });
    assert.strictEqual(resFakeMime.status, 400);
    assert.strictEqual(resFakeMime.body.ok, false);
    assert.ok(resFakeMime.body.error.includes('không hợp lệ'));

    // 3.2 File vượt quá giới hạn 3MB (> 3 * 1024 * 1024)
    const hugeBuffer = Buffer.alloc(3.5 * 1024 * 1024, 0x89);
    hugeBuffer[1] = 0x50; hugeBuffer[2] = 0x4e; hugeBuffer[3] = 0x47;
    const resHuge = await callUpload(chatUploadRoute, {
      fields: { line_uid: aliceUid, session_token: aliceToken },
      fileBuffer: hugeBuffer,
      fileName: 'huge.png',
      contentTypeHeader: 'image/png'
    });
    assert.strictEqual(resHuge.status, 400);
    assert.strictEqual(resHuge.body.ok, false);

    console.log('  ✓ Chặn file giả mạo MIME/magic bytes và file vượt 3MB thành công.');

    console.log('\n========================================');
    console.log('PHẦN 4: KIỂM THỬ PATH TRAVERSAL & 404 NOT FOUND');
    console.log('========================================');

    // 4.1 Path traversal attack
    const resTraversal1 = await callServe(chatImgRoute, { id: '../../../etc/passwd' });
    assert.strictEqual(resTraversal1.status, 400);

    const resTraversal2 = await callServe(chatImgRoute, { id: '..\\..\\server\\index.js' });
    assert.strictEqual(resTraversal2.status, 400);

    // 4.2 Non-existent 32-hex ID
    const resNotFound = await callServe(chatImgRoute, { id: '00000000000000000000000000000000' });
    assert.strictEqual(resNotFound.status, 404);

    console.log('  ✓ Chống path traversal và xử lý 404 chuẩn xác.');

    console.log('\n========================================');
    console.log('PHẦN 5: KIỂM THỬ TÍCH HỢP REPORT_IMG');
    console.log('========================================');

    // 5.1 Báo cáo ảnh không tồn tại -> Bắt buộc thất bại
    const resReportFake = await callChat(chatRoute, {
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'report_img',
      img: 'ffffffffffffffffffffffffffffffff'
    });
    assert.strictEqual(resReportFake.body.ok, false);
    assert.strictEqual(resReportFake.body.error, 'image_not_found');

    // 5.2 Báo cáo ảnh hợp lệ đã upload -> Thành công
    const resReportReal = await callChat(chatRoute, {
      line_uid: aliceUid,
      session_token: aliceToken,
      action: 'report_img',
      img: pngImgId
    });
    assert.strictEqual(resReportReal.body.ok, true);
    assert.ok(resReportReal.body.msg.includes('tiếp nhận báo cáo'));

    console.log('  ✓ Tích hợp report_img từ chối ảnh không tồn tại và xử lý thành công.');

    console.log('\n🎉 TẤT CẢ CÁC BỘ TEST CHAT IMAGE STORAGE ĐỀU ĐẠT CHUẨN (PASS 100%)!');
  } finally {
    cleanupTestRecords(testUids, createdImgIds);
    console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test images và database records!');
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

