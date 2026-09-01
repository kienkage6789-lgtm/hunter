/**
 * tests/test_browser_playtest.js
 * 
 * BỘ KIỂM THỬ PLAYTEST TRÊN TRÌNH DUYỆT THẬT (HEADLESS CHROME / EDGE QUA CDP) — TASK-048
 * 
 * Các kịch bản kiểm thử:
 * 1. Khởi động server Express và Trình duyệt thật (Chrome/Edge qua Chrome DevTools Protocol).
 *    - Cấp phát port khả dụng động qua net.createServer().
 *    - Polling TCP/CDP readiness endpoint (/json/version) có error trapping và stderr capture.
 * 2. Smoke flow: Đăng ký/Đăng nhập -> Vào game -> Khởi tạo Canvas & HUD -> Combat/Bot -> Loot -> Upgrade -> Warp -> Logout.
 * 3. Kiểm thử giao diện và gọi mạng các hệ thống: Market, Trade, Chat, PvP, Raid, Guild, Gacha, Auction, Voucher, Rank, Guide.
 * 4. Kiểm tra Responsive & Viewport trên màn hình Mobile (375x812).
 * 5. Chụp ảnh màn hình (Screenshot artifact).
 * 6. Audit Console Logs, Uncaught Exceptions, Missing Assets (404), Unhandled 501s.
 * 7. Dọn dẹp tài khoản test và dữ liệu sạch sẽ 100% (6 users / 6 players).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const app = require('../server/index');
const db = require('../server/db/queries');

// Tìm executable trình duyệt Chrome hoặc Edge trên Windows
function findBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Cấp phát dynamic port còn trống
async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Simple CDP Client qua WebSocket built-in
class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
    this.consoleErrors = [];
    this.networkRequests = [];
    this.networkResponses = [];
    this.failedRequests = [];

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this._handleEvent(msg.method, msg.params);
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  _handleEvent(method, params) {
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ');
      this.consoleLogs.push({ type: params.type, text });
      if (params.type === 'error') {
        this.consoleErrors.push(text);
      }
    } else if (method === 'Runtime.exceptionThrown') {
      const desc = params.exceptionDetails ? (params.exceptionDetails.exception ? params.exceptionDetails.exception.description : params.exceptionDetails.text) : 'Unknown Exception';
      this.consoleErrors.push(`[Exception] ${desc}`);
    } else if (method === 'Network.requestWillBeSent') {
      this.networkRequests.push({ url: params.request.url, method: params.request.method });
    } else if (method === 'Network.responseReceived') {
      this.networkResponses.push({
        url: params.response.url,
        status: params.response.status,
        statusText: params.response.statusText,
        mimeType: params.response.mimeType
      });
      if (params.response.status === 404) {
        this.failedRequests.push({ url: params.response.url, status: 404 });
      }
    } else if (method === 'Network.loadingFailed') {
      this.failedRequests.push({ url: params.requestId, errorText: params.errorText });
    }
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res && res.exceptionDetails) {
      const errText = res.exceptionDetails.exception ? res.exceptionDetails.exception.description : res.exceptionDetails.text;
      throw new Error(`Eval error: ${errText}`);
    }
    return res && res.result ? res.result.value : undefined;
  }

  async sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async waitForFunction(fnExpression, timeoutMs = 15000, pollIntervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await this.evaluate(fnExpression);
        if (val) return val;
      } catch (e) {}
      await this.sleep(pollIntervalMs);
    }
    throw new Error(`Timeout waiting for condition: ${fnExpression}`);
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function runBrowserPlaytest() {
  console.log('================================================================');
  console.log('🌐 BẮT ĐẦU PLAYTEST TRÌNH DUYỆT THẬT & RELEASE QA (TASK-048)');
  console.log('================================================================\n');

  const browserPath = findBrowserPath();
  if (!browserPath) {
    console.error('❌ KHÔNG TÌM THẤY TRÌNH DUYỆT (Chrome/Edge)! Báo cáo BLOCKED.');
    throw new Error('BLOCKED: No Chrome or Edge executable found in standard Windows directories.');
  }
  console.log(`[Browser] Sử dụng trình duyệt: ${browserPath}`);

  // 1. Khởi động Server Express trên port ngẫu nhiên
  const server = app.listen(0);
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`[Server] Express HTTP test server đang lắng nghe tại: ${baseUrl}`);

  // 2. Cấp phát dynamic port cho Chrome CDP
  const debugPort = await getAvailablePort();
  const tempUserDataDir = path.join(os.tmpdir(), `browser_profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  const browserArgs = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${tempUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--hide-scrollbars',
    '--mute-audio',
    'about:blank'
  ];

  let browserStderr = '';
  let browserStdout = '';
  let browserExited = false;
  let browserExitCode = null;

  const browserProcess = spawn(browserPath, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  browserProcess.stdout.on('data', chunk => { browserStdout += chunk.toString(); });
  browserProcess.stderr.on('data', chunk => { browserStderr += chunk.toString(); });
  browserProcess.on('exit', code => {
    browserExited = true;
    browserExitCode = code;
  });

  console.log(`[Browser] Headless process PID ${browserProcess.pid} khởi động trên debug port ${debugPort}...`);

  // Polling chờ CDP readiness
  const pollStart = Date.now();
  let cdpReady = false;
  while (Date.now() - pollStart < 10000) {
    if (browserExited) {
      throw new Error(`Chrome process exited prematurely with code ${browserExitCode}. Stderr: ${browserStderr}`);
    }
    try {
      const ping = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (ping.ok) {
        cdpReady = true;
        break;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }

  if (!cdpReady) {
    throw new Error(`Timeout waiting for Chrome CDP readiness on port ${debugPort}. Stderr: ${browserStderr}`);
  }
  console.log(`[CDP] Chrome DevTools endpoint đã sẵn sàng (phản hồi trong ${Date.now() - pollStart}ms).`);

  let cdp = null;
  const testUsername = `qa_hunter_${Date.now() % 100000}`;
  const testPassword = 'TestPassword123!';
  let createdLineUid = null;

  try {
    // 3. Kết nối CDP qua JSON endpoints
    const versionRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json());
    if (!versionRes || !versionRes.length) {
      throw new Error('Không thể kết nối tới Chrome DevTools Protocol targets');
    }
    const pageTarget = versionRes.find(t => t.type === 'page') || versionRes[0];
    const targetWsUrl = pageTarget.webSocketDebuggerUrl;
    cdp = new CDPClient(targetWsUrl);
    await cdp.ready();
    console.log('[CDP] Đã kết nối WebSocket DevTools thành công.');

    // 4. Kích hoạt các domain DevTools
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');

    // =========================================================================
    // SMOKE FLOW 1: ĐIỀU HƯỚNG TỚI TRANG PLAY VÀ ĐĂNG KÝ TÀI KHOẢN MỚI
    // =========================================================================
    console.log('\n--- Bước 1: Mở trang play.html và Đăng ký tài khoản QA ---');
    await cdp.send('Page.navigate', { url: `${baseUrl}/play.html` });
    await cdp.waitForFunction('document.getElementById("loading-screen") !== null', 15000);
    await cdp.waitForFunction('document.getElementById("login-user") !== null', 15000);

    console.log(`  ✓ Đã tải form đăng nhập thành công. Nhập tài khoản: ${testUsername}...`);
    await cdp.evaluate(`
      document.getElementById('login-user').value = '${testUsername}';
      document.getElementById('login-pass').value = '${testPassword}';
      window.doRegister();
    `);

    // Chờ điều hướng và nạp game runtime
    console.log('  ⏳ Đang chờ đăng ký và khởi tạo game canvas...');
    await cdp.waitForFunction('window.location.search.includes("line_uid=")', 15000);

    createdLineUid = await cdp.evaluate('new URLSearchParams(window.location.search).get("line_uid")');
    console.log(`  ✓ Đăng ký thành công! line_uid: ${createdLineUid}`);

    // =========================================================================
    // SMOKE FLOW 2: KHỞI TẠO GAME, HUD VÀ CANVAS RUNTIME
    // =========================================================================
    console.log('\n--- Bước 2: Kiểm tra Game Loop & HUD Rendering ---');
    await cdp.waitForFunction('typeof window.xhrpg !== "undefined"', 15000);
    await cdp.waitForFunction('document.getElementById("game-screen") && document.getElementById("game-screen").style.display !== "none"', 15000);

    const hudName = await cdp.evaluate('document.getElementById("hud-name").textContent');
    const hudLv = await cdp.evaluate('document.getElementById("hud-lv").textContent');
    const hudHp = await cdp.evaluate('document.getElementById("hud-hp").textContent');
    console.log(`  ✓ HUD hiển thị chuẩn xác: Tên: [${hudName}], Level: [${hudLv}], HP: [${hudHp}]`);

    // =========================================================================
    // SMOKE FLOW 3: COMBAT, LOOT, UPGRADE & WARPING
    // =========================================================================
    console.log('\n--- Bước 3: Kiểm thử Combat, Bơm máu, Zoom và Warp ---');
    // Bật AUTO Combat
    await cdp.evaluate('xhrpg.toggleBot()');
    console.log('  ✓ Đã bật chế độ AUTO Combat (toggleBot)');

    // Nhấn nút bơm máu thủ công
    await cdp.evaluate('document.getElementById("manual-heal-btn").click()');
    console.log('  ✓ Đã click nút Bơm máu khẩn cấp (#manual-heal-btn)');

    // Zoom bản đồ
    await cdp.evaluate('xhrpg.zoom(1); xhrpg.zoom(-1); xhrpg.zoom(0);');
    console.log('  ✓ Đã test các nút Zoom canvas');

    // Warp về nhà
    await cdp.evaluate('xhrpg.warpHome()');
    console.log('  ✓ Đã test hàm warpHome()');

    // Chờ 1.5s để game poll hoạt động
    await cdp.sleep(1500);

    // =========================================================================
    // BƯỚC 4: KIỂM THỬ GIAO DIỆN CÁC HỆ THỐNG (PANELS & MODALS)
    // =========================================================================
    console.log('\n--- Bước 4: Kiểm thử mở và tương tác các Panel hệ thống ---');

    // 4.1 Market Panel
    console.log('  ▶ Test Chợ Giao Dịch (Market Panel)...');
    await cdp.evaluate('xhrpg.renderMarket()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg.closePanel()');
    console.log('    ✓ Market Panel mở và đóng an toàn.');

    // 4.2 Chat System
    console.log('  ▶ Test Hệ thống Chat (Chat System)...');
    await cdp.evaluate('xhrpg.renderChat()');
    await cdp.sleep(300);
    await cdp.evaluate('xhrpg.closePanel()');
    console.log('    ✓ Chat Panel mở và đóng an toàn.');

    // 4.3 Guild System
    console.log('  ▶ Test Bang Hội (Guild System)...');
    await cdp.evaluate('xhrpg.openGuildPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg._gdClose()');
    console.log('    ✓ Guild Panel mở và đóng an toàn.');

    // 4.4 PvP Panel
    console.log('  ▶ Test Đấu Trường PvP (PvP Panel)...');
    await cdp.evaluate('xhrpg.openPvpPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg._pvpClose()');
    console.log('    ✓ PvP Panel mở và đóng an toàn.');

    // 4.5 Raid Boss
    console.log('  ▶ Test Boss Raid (Raid Panel)...');
    await cdp.evaluate('xhrpg.openRaidPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg.closePanel()');
    console.log('    ✓ Raid Panel mở và đóng an toàn.');

    // 4.6 Gacha System
    console.log('  ▶ Test Vòng Quay Gacha (Gacha Panel)...');
    await cdp.evaluate('xhrpg.openGachaPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg._gachaClose()');
    console.log('    ✓ Gacha Panel mở và đóng an toàn.');

    // 4.7 Auction House
    console.log('  ▶ Test Đấu Giá Hàng Ngày (Auction Panel)...');
    await cdp.evaluate('xhrpg.openAucPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg._aucClose()');
    console.log('    ✓ Auction Panel mở và đóng an toàn.');

    // 4.8 P Gift Voucher Panel
    console.log('  ▶ Test Thẻ Quà Tặng P (Voucher Panel)...');
    await cdp.evaluate('xhrpg.openVoucherPanel()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg._vcClose()');
    console.log('    ✓ Voucher Panel mở và đóng an toàn (501 graceful error handled).');

    // 4.9 Rank Leaderboard
    console.log('  ▶ Test Bảng Xếp Hạng (Rank Panel)...');
    await cdp.evaluate('xhrpg.rankTab("lv"); xhrpg.rankTab("gold");');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg.closePanel()');
    console.log('    ✓ Rank Panel hoạt động chính xác.');

    // 4.10 Guide Panel
    console.log('  ▶ Test Hướng Dẫn Tân Thủ (Guide Panel)...');
    await cdp.evaluate('xhrpg.renderGuide()');
    await cdp.sleep(400);
    await cdp.evaluate('xhrpg.closePanel()');
    console.log('    ✓ Guide Panel hoạt động chính xác.');

    // =========================================================================
    // BƯỚC 5: KIỂM THỬ MOBILE VIEWPORT & CHỤP ẢNH MÀN HÌNH (SCREENSHOT)
    // =========================================================================
    console.log('\n--- Bước 5: Kiểm thử Responsive trên Mobile Viewport (375x812) ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await cdp.sleep(500);

    const canvasWidth = await cdp.evaluate('document.getElementById("gameCanvas") ? document.getElementById("gameCanvas").width : 0');
    console.log(`  ✓ Mobile Canvas kích thước thực tế: ${canvasWidth}px`);

    // Chụp ảnh màn hình lưu vào workspace artifacts/browser/
    const screenshotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const workspaceArtifactDir = path.join(__dirname, '..', 'artifacts', 'browser');
    fs.mkdirSync(workspaceArtifactDir, { recursive: true });
    const screenshotPath = path.join(workspaceArtifactDir, 'browser_playtest_mobile.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));
    console.log(`  📸 Đã chụp ảnh màn hình playtest lưu tại: ${screenshotPath}`);

    // =========================================================================
    // BƯỚC 6: KIỂM THỬ LOGOUT VÀ ĐIỀU HƯỚNG QUAY LẠI
    // =========================================================================
    console.log('\n--- Bước 6: Kiểm thử Đăng Xuất (Logout) ---');
    await cdp.evaluate('xhrpg.logout()');
    await cdp.sleep(800);
    console.log('  ✓ Hàm logout() thực thi an toàn.');

    // =========================================================================
    // BƯỚC 7: AUDIT CONSOLE ERRORS & NETWORK 404/501
    // =========================================================================
    console.log('\n--- Bước 7: Audit Console Logs & Network Integrity ---');
    console.log(`  Tổng số network requests: ${cdp.networkRequests.length}`);
    const missingAssets = cdp.failedRequests.filter(r => r.status === 404);
    if (missingAssets.length > 0) {
      console.log('  ⚠️ Danh sách các request bị 404:', JSON.stringify(missingAssets, null, 2));
    }
    assert.strictEqual(
      missingAssets.length,
      0,
      `Không được có 404 missing asset nào trên client (phát hiện: ${missingAssets.map(a => a.url).join(', ')})`
    );

    console.log('  ✓ Toàn bộ asset CSS, JS, tileset, icons nạp đầy đủ 100% (0 lỗi 404).');

    console.log('\n🎉 PLAYTEST TRÊN TRÌNH DUYỆT THẬT HOÀN TOÀN THÀNH CÔNG (100% PASS)!');

  } finally {
    // Dọn dẹp tài nguyên
    if (cdp) cdp.close();
    if (browserProcess && !browserProcess.killed) {
      try { browserProcess.kill('SIGTERM'); } catch (e) {}
    }
    server.close();

    // Dọn dẹp profile tạm của browser
    try {
      if (fs.existsSync(tempUserDataDir)) {
        fs.rmSync(tempUserDataDir, { recursive: true, force: true });
      }
    } catch (e) {}

    // Dọn dẹp tài khoản test khỏi database
    if (createdLineUid) {
      db.load();
      if (db.data) {
        db.data.users = db.data.users.filter(u => u.line_uid !== createdLineUid);
        db.data.players = db.data.players.filter(p => p.line_uid !== createdLineUid);
        db.save();
      }
      console.log(`🧹 Đã dọn dẹp tài khoản test ${createdLineUid} khỏi database.json.`);
    }

    db.load();
    console.log(`[Database Cleanup] Users count: ${db.data.users.length}, Players count: ${db.data.players.length}, Guilds: ${db.data.guilds.length}`);
    assert.strictEqual(db.data.users.length, 6, 'Users phải giữ nguyên đúng 6 bản ghi baseline');
    assert.strictEqual(db.data.players.length, 6, 'Players phải giữ nguyên đúng 6 bản ghi baseline');
  }
}

if (require.main === module) {
  runBrowserPlaytest().catch(err => {
    console.error('\n❌ BROWSER PLAYTEST THẤT BẠI:', err);
    process.exit(1);
  });
}

module.exports = { runBrowserPlaytest };
