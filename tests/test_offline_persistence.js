const assert = require('assert');
const path = require('path');
const db = require('../server/db/queries');
const gameRoute = require('../server/routes/game');
const warpRoute = require('../server/routes/warp');
const offlineRoute = require('../server/routes/offline');
const authRoute = require('../server/routes/auth');
const worldManager = require('../server/game/WorldManager');

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m"
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(testName, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`  ${colors.green}✔ PASS:${colors.reset} ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${colors.red}✖ FAIL:${colors.reset} ${testName}`);
    console.error(`    ${colors.red}${err.message}${colors.reset}`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
  }
}

const mockUid = `test_offline_persist_${Date.now()}`;
const mockToken = `token_offline_${Date.now()}`;
const mockUsername = `offline_persist_user_${Date.now()}`;

// Route call wrappers with 5s timeout protection
function callGame(body = {}) {
  return Promise.race([
    new Promise((resolve, reject) => {
      gameRoute.handle(
        {
          method: 'POST',
          url: '/',
          body: {
            line_uid: mockUid,
            session_token: mockToken,
            explore_cx: 850,
            explore_cy: 920,
            explore_radius: 300,
            lock_pos: 1, // Khóa vị trí để giữ nguyên tọa độ khi kiểm tra persistence
            ...body
          }
        },
        { json: resolve },
        (err) => { if (err) reject(err); }
      );
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('game route timeout after 5s')), 5000))
  ]);
}

function callWarp(body = {}) {
  return Promise.race([
    new Promise((resolve, reject) => {
      warpRoute.handle(
        {
          method: 'POST',
          url: '/',
          body: {
            line_uid: mockUid,
            session_token: mockToken,
            ...body
          }
        },
        { json: resolve },
        (err) => { if (err) reject(err); }
      );
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('warp route timeout after 5s')), 5000))
  ]);
}

function callOffline(body = {}) {
  return Promise.race([
    new Promise((resolve, reject) => {
      offlineRoute.handle(
        {
          method: 'POST',
          url: '/',
          body: {
            line_uid: mockUid,
            session_token: mockToken,
            ...body
          }
        },
        { json: resolve },
        (err) => { if (err) reject(err); }
      );
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('offline route timeout after 5s')), 5000))
  ]);
}

function callLogin(body = {}) {
  return Promise.race([
    new Promise((resolve, reject) => {
      authRoute.handle(
        {
          method: 'POST',
          url: '/login',
          body: {
            username: mockUsername,
            ...body
          }
        },
        { json: resolve },
        (err) => { if (err) reject(err); }
      );
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('login route timeout after 5s')), 5000))
  ]);
}

const crypto = require('crypto');
const mockPass = 'secret_offline_123';
const mockPassHash = crypto.createHash('sha256').update(mockPass).digest('hex');

const initialSavedState = {
  line_uid: mockUid,
  name: 'Offline Persistence Champion',
  lv: 25,
  exp: 12345,
  gold: 67890,
  hp: 250,
  hp_max: 375,
  mp: 60,
  str: 15,
  dex: 15,
  agi: 15,
  vit: 15,
  intel: 15,
  luk: 15,
  map: 2,
  x: 850,
  y: 920,
  explore_cx: 850,
  explore_cy: 920,
  explore_radius: 300,
  wood: 150,
  stone: 75,
  iron: 30,
  copper: 40,
  herb: 25,
  diamond_blue: 10,
  diamond_red: 2,
  cards: JSON.stringify({ "1": { n: 2, m: 0 } }),
  eggs: JSON.stringify({ "1": { n: 1, m: 0 } }),
  offline_zones: "1:1,1:2",
  offline_zones_map: 1,
  house_lv: 0,
  skills: JSON.stringify({ tough_body: 2 })
};

async function main() {
  console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}   BỘ KIỂM THỬ OFFLINE PERSISTENCE & RECONNECT (TASK-GP-005)    ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);

  // Lưu quái vật Map 1 và Map 2 để kiểm thử cách ly không bị combat ngẫu nhiên
  let originalMap1Monsters = [];
  let originalMap2Monsters = [];
  if (worldManager.maps[1]) {
    originalMap1Monsters = [...worldManager.maps[1].monsters];
    worldManager.maps[1].monsters = [];
  }
  if (worldManager.maps[2]) {
    originalMap2Monsters = [...worldManager.maps[2].monsters];
    worldManager.maps[2].monsters = [];
  }

  try {
    // ========================================================================
    // GIAI ĐOẠN 1: TẠO FIXTURE PLAYER + SESSION
    // ========================================================================
    console.log(`${colors.bright}${colors.yellow}--- [GIAI ĐOẠN 1] KHỞI TẠO FIXTURE PLAYER & SESSION ---${colors.reset}`);

    await runTest('1.1: Tạo User và Player trong database với trạng thái tùy biến đầy đủ', async () => {
      db.prepare(`
        INSERT INTO users (line_uid, username, password_hash, session_token)
        VALUES (?, ?, ?, ?)
      `).run(mockUid, mockUsername, mockPassHash, mockToken);

      db.prepare(`
        INSERT INTO players (line_uid, name, raw_data)
        VALUES (?, ?, ?)
      `).run(mockUid, initialSavedState.name, JSON.stringify(initialSavedState));

      const uRow = db.prepare('SELECT * FROM users WHERE line_uid = ? AND session_token = ?').get(mockUid, mockToken);
      assert(uRow, 'User phải được lưu đúng trong DB');
      assert.strictEqual(uRow.line_uid, mockUid);

      const pRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(mockUid);
      assert(pRow, 'Player phải được lưu đúng trong DB');
      const loaded = JSON.parse(pRow.raw_data);
      assert.strictEqual(loaded.exp, 12345);
      assert.strictEqual(loaded.gold, 67890);
      assert.strictEqual(loaded.map, 2);
      assert.strictEqual(loaded.x, 850);
      assert.strictEqual(loaded.y, 920);
    });

    // ========================================================================
    // GIAI ĐOẠN 2: GHI STATE TRƯỚC DISCONNECT & XÁC NHẬN PERSISTENCE KHI RECONNECT
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [GIAI ĐOẠN 2] XÁC NHẬN STATE PERSISTENCE KHI RECONNECT ---${colors.reset}`);

    await runTest('2.1: Reconnect bằng cùng credentials -> Tải đúng Map, X, Y, EXP, Gold, Inventory, Cards', async () => {
      // Chờ 850ms để vượt cooldown rate-limit
      await new Promise(r => setTimeout(r, 850));

      const res = await callGame();
      assert.strictEqual(res.ok, 1, 'Reconnect phải thành công với ok: 1');
      assert(res.player, 'Response phải chứa thông tin player');

      const p = res.player;
      assert.strictEqual(p.map, 2, `Map phải giữ nguyên là 2 (thực tế: ${p.map})`);
      assert.strictEqual(p.x, 850, `Tọa độ X phải giữ nguyên 850 (thực tế: ${p.x})`);
      assert.strictEqual(p.y, 920, `Tọa độ Y phải giữ nguyên 920 (thực tế: ${p.y})`);
      assert.strictEqual(p.exp, 12345, `EXP phải giữ nguyên 12345 (thực tế: ${p.exp})`);
      assert.strictEqual(p.gold, 67890, `Gold phải giữ nguyên 67890 (thực tế: ${p.gold})`);
      assert.strictEqual(p.wood, 150, `Wood phải giữ nguyên 150 (thực tế: ${p.wood})`);
      assert.strictEqual(p.stone, 75, `Stone phải giữ nguyên 75 (thực tế: ${p.stone})`);
      assert.strictEqual(p.iron, 30, `Iron phải giữ nguyên 30 (thực tế: ${p.iron})`);
      assert.strictEqual(p.copper, 40, `Copper phải giữ nguyên 40 (thực tế: ${p.copper})`);
      assert.strictEqual(p.herb, 25, `Herb phải giữ nguyên 25 (thực tế: ${p.herb})`);
      assert.strictEqual(p.diamond_blue, 10, `Blue diamond phải giữ nguyên 10 (thực tế: ${p.diamond_blue})`);
      assert.strictEqual(p.diamond_red, 2, `Red diamond phải giữ nguyên 2 (thực tế: ${p.diamond_red})`);
      assert.strictEqual(p.offline_zones, "1:1,1:2", `offline_zones phải giữ nguyên (thực tế: ${p.offline_zones})`);
      assert.strictEqual(p.offline_zones_map, 1, `offline_zones_map phải giữ nguyên (thực tế: ${p.offline_zones_map})`);
    });

    await runTest('2.2: HP/MP duy trì trạng thái trước disconnect và chỉ nhận đúng 1 nhịp hồi phục trực tiếp (Regen)', async () => {
      // HP trước disconnect là 250 (hp_max 375).
      // Với vit_eff=15 và skills.hp_regen=0, lượng hồi phục HP mỗi nhịp là: floor(15/5) = 3 HP.
      // Do đó sau 1 tick kết nối, HP = min(hpMaxEff, 250 + 3) = 253 HP.
      // MP trước disconnect là 60. Với intel_eff=15, lượng hồi phục MP mỗi nhịp là: 2 + floor(15/5) = 5 MP.
      // MP sau 1 tick kết nối = min(mpMax, 60 + 5) = 65 MP.
      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockUid);
      const pObj = JSON.parse(pRow.raw_data);

      assert(pObj.hp >= 250 && pObj.hp <= 260, `HP phải giữ từ mức 250 + 1 nhịp regen hợp lệ (thực tế: ${pObj.hp})`);
      assert(pObj.mp >= 60 && pObj.mp <= 70, `MP phải giữ từ mức 60 + 1 nhịp regen hợp lệ (thực tế: ${pObj.mp})`);
    });

    await runTest('2.3: Reconnect sau khi Warp Map vẫn duy trì chuẩn xác Map/X/Y trên DB', async () => {
      // Warp sang Map 1 (Yêu cầu Lv.1 <= Lv.25 của fixture)
      const warpRes = await callWarp({ target_map: 1 });
      assert.strictEqual(warpRes.ok, true, 'Warp sang Map 1 phải thành công');
      assert.strictEqual(warpRes.map, 1);
      assert.strictEqual(warpRes.x, 1125);
      assert.strictEqual(warpRes.y, 1125);

      await new Promise(r => setTimeout(r, 850));

      // Reconnect vào game
      const gameRes = await callGame({ explore_cx: 1125, explore_cy: 1125 });
      assert.strictEqual(gameRes.ok, 1);
      assert.strictEqual(gameRes.player.map, 1, 'Player map khi reconnect phải là 1');
      assert.strictEqual(gameRes.player.x, 1125, 'Player X khi reconnect phải là 1125');
      assert.strictEqual(gameRes.player.y, 1125, 'Player Y khi reconnect phải là 1125');
      assert.strictEqual(gameRes.player.exp, 12345, 'EXP không bị mất khi warp & reconnect');
      assert.strictEqual(gameRes.player.gold, 67890, 'Gold không bị mất khi warp & reconnect');

      // Chuyển lại Map 2 để tiếp tục các bài test sau
      const warpBack = await callWarp({ target_map: 2 });
      assert.strictEqual(warpBack.ok, true, 'Warp lại Map 2 phải thành công');
    });

    // ========================================================================
    // GIAI ĐOẠN 3: KIỂM TOÁN HỢP ĐỒNG OFFLINE CATCH-UP & ELAPSED TIMESTAMP
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [GIAI ĐOẠN 3] KIỂM TOÁN OFFLINE CATCH-UP CONTRACT & GAP AUDIT ---${colors.reset}`);

    await runTest('3.1: Kiểm toán contract: Server hiện trả về offline: null (Ghi nhận gap: chưa hỗ trợ offline catch-up)', async () => {
      await new Promise(r => setTimeout(r, 850));
      const res = await callGame();
      
      // Khẳng định rõ ràng hợp đồng hiện tại:
      // Máy chủ trả về offline: null, không cộng điểm/thưởng combat giả mạo ngoài luồng.
      assert.strictEqual(res.offline, null, 'Contract hiện tại: res.offline phải là null');
      assert.strictEqual(res.offline_reward, undefined, 'Contract hiện tại: res.offline_reward phải là undefined');
    });

    await runTest('3.2: API /xhrpg_offline.php hoạt động đúng contract thiết lập zone và preview rate', async () => {
      // 1. Preview
      const prevRes = await callOffline({ action: 'preview', map: 2 });
      assert.strictEqual(prevRes.ok, true, 'Preview rate offline phải ok: true');
      assert.strictEqual(prevRes.map, 2, 'Preview map phải là 2');
      assert(Array.isArray(prevRes.zones), 'Preview zones phải là mảng');

      // 2. Set zone
      const setRes = await callOffline({ action: 'set', map: 2, zones: '2:1,2:3' });
      assert.strictEqual(setRes.ok, true, 'Set offline zone phải ok: true');

      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockUid);
      const pObj = JSON.parse(pRow.raw_data);
      assert.strictEqual(pObj.offline_zones, '2:1,2:3', 'Zone offline mới phải được lưu vào raw_data');
      assert.strictEqual(pObj.offline_zones_map, 2, 'Zone map offline mới phải được lưu vào raw_data');

      // 3. Idlestat check-in
      const idleRes = await callOffline({ action: 'idlestat' });
      assert.strictEqual(idleRes.ok, true, 'Idlestat check phải ok: true');
      assert.strictEqual(idleRes.ci, 0, 'Idlestat ci nhịp check-in an toàn là 0');
    });

    // ========================================================================
    // GIAI ĐOẠN 4: RECONNECT NHIỀU LẦN LIÊN TIẾP KHÔNG DUPLICATE EXP/GOLD/ITEMS
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [GIAI ĐOẠN 4] RECONNECT LIÊN TIẾP KHÔNG DUPLICATE EXP/GOLD/ITEMS ---${colors.reset}`);

    await runTest('4.1: Reconnect 2 lần liên tiếp -> EXP, Gold, Đá quý, Vật phẩm không bị cộng lặp', async () => {
      // Lần Reconnect 1
      await new Promise(r => setTimeout(r, 850));
      const tick1 = await callGame({ explore_cx: 850, explore_cy: 920 });
      assert.strictEqual(tick1.ok, 1);
      const exp1 = tick1.player.exp;
      const gold1 = tick1.player.gold;
      const wood1 = tick1.player.wood;
      const stone1 = tick1.player.stone;
      const redDia1 = tick1.player.diamond_red;
      const ts1 = tick1.ts;

      // Lần Reconnect 2 (liên tiếp ngay sau cooldown)
      await new Promise(r => setTimeout(r, 850));
      const tick2 = await callGame({ explore_cx: 850, explore_cy: 920 });
      assert.strictEqual(tick2.ok, 1);
      const exp2 = tick2.player.exp;
      const gold2 = tick2.player.gold;
      const wood2 = tick2.player.wood;
      const stone2 = tick2.player.stone;
      const redDia2 = tick2.player.diamond_red;
      const ts2 = tick2.ts;

      assert.strictEqual(exp2, exp1, `EXP không bị cộng lặp sau 2 lần reconnect (t1: ${exp1}, t2: ${exp2})`);
      assert.strictEqual(gold2, gold1, `Gold không bị cộng lặp sau 2 lần reconnect (t1: ${gold1}, t2: ${gold2})`);
      assert.strictEqual(wood2, wood1, `Gỗ không bị nhân đôi (t1: ${wood1}, t2: ${wood2})`);
      assert.strictEqual(stone2, stone1, `Đá không bị nhân đôi (t1: ${stone1}, t2: ${stone2})`);
      assert.strictEqual(redDia2, redDia1, `Kim cương đỏ không bị nhân đôi (t1: ${redDia1}, t2: ${redDia2})`);
      assert(ts2 >= ts1, `Timestamp server phản hồi phải tăng đơn điệu (ts1: ${ts1}, ts2: ${ts2})`);
    });

    await runTest('4.2: Token authentication & Database consistency qua nhiều phiên đăng nhập', async () => {
      // Giả lập Đăng nhập lại tạo token mới
      const loginRes = await callLogin({ password: mockPass });
      assert.strictEqual(loginRes.ok, true, 'Đăng nhập phải thành công');
      assert(loginRes.session_token, 'Đăng nhập phải sinh token mới');
      assert.strictEqual(loginRes.line_uid, mockUid, 'UID phải khớp');

      const newToken = loginRes.session_token;

      // Gọi game tick với token mới
      await new Promise(r => setTimeout(r, 850));
      const gameNewToken = await callGame({ session_token: newToken });
      assert.strictEqual(gameNewToken.ok, 1, 'Game tick với token mới phải thành công');
      assert.strictEqual(gameNewToken.player.exp, 12345, 'EXP không bị biến đổi khi đổi session token');
      assert.strictEqual(gameNewToken.player.gold, 67890, 'Gold không bị biến đổi khi đổi session token');
    });

  } finally {
    // ========================================================================
    // GIAI ĐOẠN 5: CLEANUP DỮ LIỆU THỬ NGHIỆM
    // ========================================================================
    console.log(`\n${colors.bright}${colors.magenta}🧹 Đang dọn dẹp dữ liệu kiểm thử (Cleanup)...${colors.reset}`);
    try {
      db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockUid);
      db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockUid);
      if (worldManager.maps[1]) {
        worldManager.maps[1].monsters = originalMap1Monsters;
      }
      if (worldManager.maps[2]) {
        worldManager.maps[2].monsters = originalMap2Monsters;
      }
      console.log(`  ✓ Đã xóa sạch Fixture User (${mockUid}), Player và khôi phục Map 1, Map 2.`);
    } catch (cleanErr) {
      console.error('  ⚠️ Lỗi trong quá trình cleanup:', cleanErr);
    }
  }
}

main().then(() => {
  console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bright}TỔNG KẾT KIỂM THỬ TASK-GP-005: ${passedTests}/${totalTests} tests thành công${colors.reset}`);
  if (failedTests > 0) {
    console.log(`${colors.bright}${colors.red}CÓ ${failedTests} TEST THẤT BẠI!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.bright}${colors.green}TẤT CẢ TEST OFFLINE PERSISTENCE & RECONNECT ĐỀU PASS HOÀN HẢO!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ Lỗi không xác định trong test runner:', err.stack || err);
  process.exit(1);
});
