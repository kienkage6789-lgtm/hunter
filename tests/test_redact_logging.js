const assert = require('assert');
const app = require('../server/index');
const db = require('../server/db/queries');

console.log('🧪 Bắt đầu kiểm thử Redact Sensitive Request Logging (TASK-040)...');

async function runRedactLoggingTest() {
  const redact = app.redactSensitiveData;
  const sanitizeUrl = app.sanitizeUrl;

  assert.strictEqual(typeof redact, 'function', 'app.redactSensitiveData phải là hàm');
  assert.strictEqual(typeof sanitizeUrl, 'function', 'app.sanitizeUrl phải là hàm');

  console.log('\n========================================');
  console.log('PHẦN 1: UNIT TEST HELPER REDACT DỮ LIỆU NHẠY CẢM');
  console.log('========================================');

  // 1.1 Kiểm tra các trường nhạy cảm phổ biến
  const sensitiveSample = {
    username: 'hero_player',
    password: 'P@ssw0rd_Super_Secret_123!',
    session_token: 'tok_live_998877665544332211',
    token: 'jwt_bearer_token_xyz',
    admin_api_key: 'admin_secret_master_key',
    key: 'secret_query_key',
    payment_token: 'stripe_tok_charge_9988',
    card_number: '4532123456789012',
    cvv: '987',
    signature: 'sha256_hmac_secret_signature',
    line_uid: 'local_user_777',
    action: 'upgrade',
    param: 'str'
  };

  // Deep freeze / immutability check
  const inputCopy = JSON.parse(JSON.stringify(sensitiveSample));
  const sanitized = redact(sensitiveSample);

  // Không được mutate input gốc
  assert.deepStrictEqual(sensitiveSample, inputCopy, 'Helper không được làm thay đổi object đầu vào (no mutation)');

  // Các trường nhạy cảm phải bị [REDACTED]
  assert.strictEqual(sanitized.password, '[REDACTED]');
  assert.strictEqual(sanitized.session_token, '[REDACTED]');
  assert.strictEqual(sanitized.token, '[REDACTED]');
  assert.strictEqual(sanitized.admin_api_key, '[REDACTED]');
  assert.strictEqual(sanitized.key, '[REDACTED]');
  assert.strictEqual(sanitized.payment_token, '[REDACTED]');
  assert.strictEqual(sanitized.card_number, '[REDACTED]');
  assert.strictEqual(sanitized.cvv, '[REDACTED]');
  assert.strictEqual(sanitized.signature, '[REDACTED]');

  // Các trường thông thường cần thiết cho debug phải được giữ nguyên
  assert.strictEqual(sanitized.username, 'hero_player');
  assert.strictEqual(sanitized.line_uid, 'local_user_777');
  assert.strictEqual(sanitized.action, 'upgrade');
  assert.strictEqual(sanitized.param, 'str');
  console.log('  ✓ Đã kiểm tra các trường nhạy cảm đơn lẻ: toàn bộ secret bị redact, debug info được giữ nguyên.');

  // 1.2 Kiểm tra object lồng nhau (nested objects & arrays)
  const nestedSample = {
    meta: {
      user: {
        username: 'alice',
        password: 'alice_secret_nested_password'
      },
      payment: {
        stripe_token: 'tok_visa_card_token',
        amount: 5000
      }
    },
    items: [
      { id: 1, name: 'Potion' },
      { id: 2, session_token: 'nested_array_token_123' }
    ]
  };

  const nestedSanitized = redact(nestedSample);
  assert.strictEqual(nestedSanitized.meta.user.password, '[REDACTED]');
  assert.strictEqual(nestedSanitized.meta.payment.stripe_token, '[REDACTED]');
  assert.strictEqual(nestedSanitized.meta.payment.amount, 5000);
  assert.strictEqual(nestedSanitized.items[0].name, 'Potion');
  assert.strictEqual(nestedSanitized.items[1].session_token, '[REDACTED]');
  console.log('  ✓ Đã kiểm tra cấu trúc nested object và array: redact đệ quy an toàn tuyệt đối.');

  // 1.3 Kiểm tra sanitize URL query string
  const rawUrl1 = '/xhrpg_game.php?session_token=raw_secret_session_token_in_url&map=1';
  const cleanUrl1 = sanitizeUrl(rawUrl1);
  assert.ok(!cleanUrl1.includes('raw_secret_session_token_in_url'), 'URL không được chứa plaintext session_token');
  assert.ok(cleanUrl1.includes('session_token=[REDACTED]'), 'URL phải thay token bằng [REDACTED]');
  assert.ok(cleanUrl1.includes('map=1'), 'URL phải giữ lại param map=1 không nhạy cảm');

  const rawUrl2 = '/api/admin/overview?key=my_admin_private_key&page=2';
  const cleanUrl2 = sanitizeUrl(rawUrl2);
  assert.ok(!cleanUrl2.includes('my_admin_private_key'), 'URL không được chứa plaintext key');
  assert.ok(cleanUrl2.includes('key=[REDACTED]'));
  assert.ok(cleanUrl2.includes('page=2'));
  console.log('  ✓ Đã kiểm tra sanitizeUrl: URL query parameters nhạy cảm được làm sạch chính xác.');

  console.log('\n========================================');
  console.log('PHẦN 2: KIỂM THỬ THỰC TẾ HTTP LOG OUTPUT (INTERCEPT CONSOLE.LOG)');
  console.log('========================================');

  let server;
  let baseUrl;

  await new Promise((resolve, reject) => {
    try {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });

  const capturedLogs = [];
  const originalConsoleLog = console.log;

  // Intercept console.log để phân tích chính xác từng log line sinh ra bởi Express
  console.log = function (...args) {
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    capturedLogs.push(message);
    originalConsoleLog.apply(console, args);
  };

  const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const secretPassword = 'P@ssword_Secret_' + uniqueSuffix;
  const username = 'redact_user_' + uniqueSuffix;
  let testUid = null;
  let sessionToken = null;

  try {
    // 2.1 Gửi request đăng ký tài khoản có chứa password
    originalConsoleLog('▶ Gửi HTTP POST /api/register với plaintext password...');
    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: secretPassword })
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 200);
    assert.strictEqual(regData.ok, true);
    testUid = regData.line_uid;
    sessionToken = regData.session_token;

    // 2.2 Gửi request game snapshot có chứa session_token
    originalConsoleLog('▶ Gửi HTTP POST /xhrpg_game.php với session_token...');
    const gameRes = await fetch(`${baseUrl}/xhrpg_game.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_uid: testUid, session_token: sessionToken })
    });
    const gameData = await gameRes.json();
    assert.strictEqual(gameRes.status, 200);
    assert.ok(gameData.ok === 1 || gameData.ok === true);

    // 2.3 Gửi request payment deferred có chứa payment_token & card_number
    const rawCardNumber = '4000123456789999';
    const rawPaymentToken = 'pay_tok_live_credit_card_secret';
    originalConsoleLog('▶ Gửi HTTP POST /xhrpg_stripe_topup.php với payment credentials...');
    const payRes = await fetch(`${baseUrl}/xhrpg_stripe_topup.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_uid: testUid,
        session_token: sessionToken,
        payment_token: rawPaymentToken,
        card_number: rawCardNumber
      })
    });
    const payData = await payRes.json().catch(() => null);
    assert.strictEqual(payRes.status, 501);

    // 2.4 Gửi request GET có query string nhạy cảm
    originalConsoleLog('▶ Gửi HTTP GET /api/admin/overview?key=secret_admin_query_key...');
    const getRes = await fetch(`${baseUrl}/api/admin/overview?key=secret_admin_query_key_12345`, {
      method: 'GET'
    });
    await getRes.text().catch(() => '');

    // Khôi phục console.log
    console.log = originalConsoleLog;

    console.log('\n========================================');
    console.log('PHẦN 3: XÁC THỰC BẰNG CHỨNG TRONG LOG ĐÃ BẮT ĐƯỢC');
    console.log('========================================');

    // Lấy thông tin user trong DB để kiểm tra cả password_hash và session_token
    db.load();
    const registeredUser = db.data.users.find(u => u.line_uid === testUid);
    const passwordHash = registeredUser ? registeredUser.password_hash : null;

    // Kiểm tra TOÀN BỘ console output (cả tầng Express HTTP lẫn Database/Queries layer)
    const allCapturedText = capturedLogs.join('\n');

    // Chứng minh 1: Password không xuất hiện ở bất kỳ đâu trong console log (HTTP + DB)
    assert.ok(!allCapturedText.includes(secretPassword), `BẰNG CHỨNG LỖI: Mật khẩu "${secretPassword}" bị lộ trong console log!`);
    console.log('  ✓ Chứng minh 1: Plaintext password HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log (HTTP + DB).');

    // Chứng minh 2: Session token không xuất hiện ở bất kỳ đâu trong console log (HTTP + DB)
    assert.ok(!allCapturedText.includes(sessionToken), `BẰNG CHỨNG LỖI: session_token "${sessionToken}" bị lộ trong console log!`);
    console.log('  ✓ Chứng minh 2: Plaintext session_token HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log (HTTP + DB).');

    // Chứng minh 3: Password hash không xuất hiện ở bất kỳ đâu trong console log (HTTP + DB)
    if (passwordHash) {
      assert.ok(!allCapturedText.includes(passwordHash), `BẰNG CHỨNG LỖI: password_hash "${passwordHash}" bị lộ trong console log!`);
      console.log('  ✓ Chứng minh 3: password_hash HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log (HTTP + DB).');
    }

    // Chứng minh 4: Payment token không xuất hiện ở bất kỳ đâu trong console log
    assert.ok(!allCapturedText.includes(rawPaymentToken), `BẰNG CHỨNG LỖI: payment_token "${rawPaymentToken}" bị lộ trong console log!`);
    console.log('  ✓ Chứng minh 4: Plaintext payment_token HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log.');

    // Chứng minh 5: Card number không xuất hiện ở bất kỳ đâu trong console log
    assert.ok(!allCapturedText.includes(rawCardNumber), `BẰNG CHỨNG LỖI: card_number "${rawCardNumber}" bị lộ trong console log!`);
    console.log('  ✓ Chứng minh 5: Plaintext card_number HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log.');

    // Chứng minh 6: URL query key không xuất hiện ở bất kỳ đâu trong console log
    assert.ok(!allCapturedText.includes('secret_admin_query_key_12345'), 'BẰNG CHỨNG LỖI: Query param key bị lộ trong log URL!');
    console.log('  ✓ Chứng minh 6: Plaintext URL secret key HOÀN TOÀN KHÔNG xuất hiện trong toàn bộ console log.');

    // Chứng minh 7: Các thông tin [REDACTED] và debug info an toàn vẫn đầy đủ
    assert.ok(allCapturedText.includes('[REDACTED]'), 'Console log phải có nhãn [REDACTED]');
    assert.ok(allCapturedText.includes('[HTTP] POST /api/register'), 'Log phải có method và path đăng ký');
    assert.ok(allCapturedText.includes('[HTTP] POST /xhrpg_game.php'), 'Log phải có method và path game');
    assert.ok(allCapturedText.includes(username), 'Log phải giữ lại username phục vụ debug');
    assert.ok(allCapturedText.includes(testUid), 'Log phải giữ lại line_uid phục vụ debug');
    console.log('  ✓ Chứng minh 7: Method, URL và các trường định danh debug an toàn (username, line_uid) được giữ nguyên vẹn.');

    // 3.2 Kiểm tra chế độ Production
    console.log('\n▶ Kiểm tra chế độ Production (process.env.NODE_ENV = "production")...');
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const prodLogs = [];
    console.log = function (...args) {
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      prodLogs.push(msg);
      originalConsoleLog.apply(console, args);
    };

    const prodPass = 'prod_secret_pass_' + uniqueSuffix;
    const prodRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: prodPass })
    });
    await prodRes.json().catch(() => {});

    console.log = originalConsoleLog;
    process.env.NODE_ENV = oldEnv;

    const prodText = prodLogs.join('\n');
    assert.ok(!prodText.includes(prodPass), 'Production log tuyệt đối không được chứa plaintext password');
    if (passwordHash) {
      assert.ok(!prodText.includes(passwordHash), 'Production log tuyệt đối không được chứa password_hash');
    }
    assert.ok(!prodText.includes(sessionToken), 'Production log tuyệt đối không được chứa session_token');
    assert.ok(prodText.includes('[REDACTED]'), 'Production log phải hiển thị [REDACTED]');
    console.log('  ✓ Production mode: Tuyệt đối không để lộ credential trong production log output.');

    console.log('\n🎉 KIỂM THỬ REDACT LOGGING THÀNH CÔNG RỰC RỠ (PASS 100%)!');
  } finally {
    console.log = originalConsoleLog;
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
    // Dọn dẹp test user
    if (testUid) {
      db.load();
      if (db.data) {
        if (Array.isArray(db.data.users)) {
          db.data.users = db.data.users.filter(u => u.line_uid !== testUid);
        }
        if (Array.isArray(db.data.players)) {
          db.data.players = db.data.players.filter(p => p.line_uid !== testUid);
        }
        db.save();
      }
      console.log('🧹 Đã dọn dẹp sạch sẽ toàn bộ test records khỏi database!');
    }
  }
}

runRedactLoggingTest().catch(err => {
  console.error('\n❌ TEST REDACT LOGGING FAILED:', err);
  process.exit(1);
});
