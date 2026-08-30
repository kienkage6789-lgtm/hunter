const assert = require('assert');
const path = require('path');
const db = require('../server/db/queries');
const gameRoute = require('../server/routes/game');
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
    throw err;
  }
}

// Helper mock Math.random xác định cho async API calls
async function withMockRandomAsync(mockValues, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    if (index < mockValues.length) {
      return mockValues[index++];
    }
    return 0.5;
  };
  try {
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
}

console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}   BỘ KIỂM THỬ SHARED HP & MULTIPLAYER COMBAT AUDIT (TASK-GP-003) ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);

const timestamp = Date.now();
const mockLineUidA = `test_multi_user_A_${timestamp}`;
const mockTokenA = `multi_token_A_${timestamp}`;

const mockLineUidB = `test_multi_user_B_${timestamp}`;
const mockTokenB = `multi_token_B_${timestamp}`;

const initialPlayerA = {
  line_uid: mockLineUidA,
  name: 'Multiplayer Hunter A',
  display_name: 'Multiplayer Hunter A',
  lv: 30,
  exp: 0,
  gold: 5000,
  hp: 800,
  hp_max: 800,
  mp: 200,
  str: 30,
  dex: 30,
  agi: 20,
  vit: 20,
  intel: 20,
  luk: 10,
  x: 1000,
  y: 1000,
  map: 1,
  active_gun: 0,
  gun_use_pistol: 1,
  gun_pistol_lv: 5,
  stat_pts: 0,
  skill_pts: 0,
  speed_modifier: 1.0,
  wander_change_rate: 0.1,
  target_monster_id: null,
  skills: JSON.stringify({ double_attack: 0 }),
  cards: '{}',
  eggs: '{}',
  drop_log: '[]'
};

const initialPlayerB = {
  line_uid: mockLineUidB,
  name: 'Multiplayer Hunter B',
  display_name: 'Multiplayer Hunter B',
  lv: 30,
  exp: 0,
  gold: 5000,
  hp: 800,
  hp_max: 800,
  mp: 200,
  str: 30,
  dex: 30,
  agi: 20,
  vit: 20,
  intel: 20,
  luk: 10,
  x: 1020,
  y: 1000,
  map: 1,
  active_gun: 0,
  gun_use_pistol: 1,
  gun_pistol_lv: 5,
  stat_pts: 0,
  skill_pts: 0,
  speed_modifier: 1.0,
  wander_change_rate: 0.1,
  target_monster_id: null,
  skills: JSON.stringify({ double_attack: 0 }),
  cards: '{}',
  eggs: '{}',
  drop_log: '[]'
};

// Fixture setup DB
db.prepare(`
  INSERT INTO users (line_uid, username, password_hash, session_token)
  VALUES (?, ?, ?, ?)
`).run(mockLineUidA, 'multiuser_a', 'hash_pass_a', mockTokenA);

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUidA,
  initialPlayerA.name,
  JSON.stringify(initialPlayerA)
);

db.prepare(`
  INSERT INTO users (line_uid, username, password_hash, session_token)
  VALUES (?, ?, ?, ?)
`).run(mockLineUidB, 'multiuser_b', 'hash_pass_b', mockTokenB);

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUidB,
  initialPlayerB.name,
  JSON.stringify(initialPlayerB)
);

// Lưu quái vật gốc của Map 1 để khôi phục khi hoàn tất test
let originalMonsters = [];
if (worldManager.maps[1]) {
  originalMonsters = [...worldManager.maps[1].monsters];
  worldManager.maps[1].monsters = []; // Xóa quái ngẫu nhiên để test hoàn toàn deterministic
}

// Track last tick timestamp per player để vượt qua rate limit 800ms
const lastCallTime = {
  [mockLineUidA]: 0,
  [mockLineUidB]: 0
};

// Helper gọi API game tick cho từng player
async function callGamePlayer(playerUid, sessionToken, body = {}, mockRandomValues = null, enforceCooldown = true) {
  if (enforceCooldown) {
    const now = Date.now();
    const elapsed = now - (lastCallTime[playerUid] || 0);
    if (elapsed < 850) {
      await new Promise(r => setTimeout(r, 850 - elapsed));
    }
    lastCallTime[playerUid] = Date.now();
  }

  const invokeRoute = () => {
    return new Promise((resolve, reject) => {
      gameRoute.handle(
        {
          method: 'POST',
          url: '/',
          body: {
            line_uid: playerUid,
            session_token: sessionToken,
            explore_cx: 1000,
            explore_cy: 1000,
            explore_radius: 300,
            ...body
          }
        },
        {
          json: (res) => resolve(res)
        },
        (err) => { if (err) reject(err); }
      );
    });
  };

  const tickPromise = mockRandomValues && Array.isArray(mockRandomValues)
    ? withMockRandomAsync(mockRandomValues, invokeRoute)
    : invokeRoute();

  return await Promise.race([
    tickPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Game tick timeout after 5s for ${playerUid}`)), 5000))
  ]);
}

// Reset state player về fixture mong muốn
function resetPlayerState(playerUid, customProps = {}) {
  const isA = playerUid === mockLineUidA;
  const initial = isA ? initialPlayerA : initialPlayerB;
  const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(playerUid);
  let pObj = pRow ? JSON.parse(pRow.raw_data) : {};
  pObj = {
    ...initial,
    ...pObj,
    lv: 30,
    exp: 0,
    gold: 5000,
    hp: 800,
    hp_max: 800,
    mp: 200,
    target_monster_id: null,
    cards: '{}',
    eggs: '{}',
    drop_log: '[]',
    last_tick_at: 0,
    ...customProps
  };
  db.prepare('UPDATE players SET raw_data = ? WHERE line_uid = ?').run(JSON.stringify(pObj), playerUid);
}

async function runTestSuite() {
  try {
    // ========================================================================
    // PHẦN 1: QUAN SÁT THẾ GIỚI CHUNG & TỌA ĐỘ NHIỀU NGƯỜI CHƠI (OTHERS)
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 1] MULTIPLAYER WORLD PRESENCE & OTHERS LIST ---${colors.reset}`);

    await runTest('1.1: Hai người chơi khác line_uid trên cùng Map 1 thấy nhau trong danh sách others', async () => {
      resetPlayerState(mockLineUidA, { x: 1000, y: 1000 });
      resetPlayerState(mockLineUidB, { x: 1020, y: 1000 });

      // Player A gửi tick trước
      const resA = await callGamePlayer(mockLineUidA, mockTokenA, { lock_pos: 1 });
      assert.strictEqual(resA.ok, 1, 'Player A tick phải thành công');

      // Player B gửi tick ngay sau đó
      const resB = await callGamePlayer(mockLineUidB, mockTokenB, { lock_pos: 1 });
      assert.strictEqual(resB.ok, 1, 'Player B tick phải thành công');

      // Player B phải nhìn thấy Player A trong danh sách others
      assert(Array.isArray(resB.others), 'resB.others phải là một mảng');
      const playerAInOthers = resB.others.find(p => p.name === initialPlayerA.display_name);
      assert(playerAInOthers, `Player B phải thấy Player A (${initialPlayerA.display_name}) trong danh sách others`);
      assert.strictEqual(playerAInOthers.x, 1000, 'Tọa độ X của Player A trong others phải chính xác');
      assert.strictEqual(playerAInOthers.y, 1000, 'Tọa độ Y của Player A trong others phải chính xác');
      assert.strictEqual(playerAInOthers.map, 1, 'Map của Player A phải là 1');

      // Player A gửi tick tiếp theo để thấy Player B
      const resA2 = await callGamePlayer(mockLineUidA, mockTokenA, { lock_pos: 1 });
      const playerBInOthers = resA2.others.find(p => p.name === initialPlayerB.display_name);
      assert(playerBInOthers, `Player A phải thấy Player B (${initialPlayerB.display_name}) trong danh sách others`);
      assert.strictEqual(playerBInOthers.x, 1020, 'Tọa độ X của Player B trong others phải chính xác');
    });

    // ========================================================================
    // PHẦN 2: SHARED MONSTER HP TRÊN CÙNG MAP
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 2] SHARED MONSTER HP REAL-TIME ACROSS PLAYERS ---${colors.reset}`);

    await runTest('2.1: Player A đánh quái, tick sau Player B quan sát thấy HP quái đã bị giảm chính xác', async () => {
      // Thiết lập 1 quái vật fixture duy nhất với HP lớn để không chết ngay
      const monsterId = 999951;
      const initialHp = 2000;
      const monsterFixture = {
        id: monsterId,
        mid: 1,
        name: 'Shared Poring Boss',
        lv: 5,
        hp: initialHp,
        hp_max: initialHp,
        x: 1010,
        y: 1000,
        spot_id: 1,
        spot_cx: 1000,
        spot_cy: 1000,
        spot_radius: 300
      };

      worldManager.maps[1].monsters = [monsterFixture];

      resetPlayerState(mockLineUidA, { x: 1000, y: 1000 });
      resetPlayerState(mockLineUidB, { x: 1020, y: 1000 });

      // Player A tấn công quái 999951 với lock_pos = 1
      const resA = await callGamePlayer(mockLineUidA, mockTokenA, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resA.ok, 1, 'Player A request thành công');
      const totalDmgA = (resA.events || [])
        .filter(e => e.type === 'hit' && e.mid === monsterId)
        .reduce((sum, e) => sum + (e.dmg || 0), 0);
      assert(totalDmgA > 0, `Tổng sát thương của Player A phải > 0 (thực tế: ${totalDmgA})`);

      const expectedHpAfterA = initialHp - totalDmgA;
      
      // Kiểm tra HP trong response của Player A
      const monInResA = (resA.monsters || []).find(m => m.id === monsterId);
      assert(monInResA, 'Quái phải có trong response monsters của Player A');
      assert.strictEqual(monInResA.hp, expectedHpAfterA, `HP trong response của Player A phải là ${expectedHpAfterA} (thực tế: ${monInResA.hp})`);

      // Kiểm tra trực tiếp trong WorldManager state
      const monInWorld = worldManager.getMonster(1, monsterId);
      assert(monInWorld, 'Quái phải còn tồn tại trong WorldManager');
      assert.strictEqual(monInWorld.hp, expectedHpAfterA, `HP trong WorldManager memory phải là ${expectedHpAfterA} (thực tế: ${monInWorld.hp})`);

      // Player B gửi tick ngay sau đó
      const resB = await callGamePlayer(mockLineUidB, mockTokenB, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resB.ok, 1, 'Player B request thành công');
      const monInResB = (resB.monsters || []).find(m => m.id === monsterId);
      assert(monInResB, 'Player B phải nhìn thấy quái 999951 trong response monsters');
      
      const totalDmgB = (resB.events || [])
        .filter(e => e.type === 'hit' && e.mid === monsterId)
        .reduce((sum, e) => sum + (e.dmg || 0), 0);

      const expectedHpAfterB = expectedHpAfterA - totalDmgB;
      assert.strictEqual(monInResB.hp, expectedHpAfterB, `Player B quan sát HP giảm sau cả 2 đòn đánh (${expectedHpAfterB})`);
      assert.strictEqual(worldManager.getMonster(1, monsterId).hp, expectedHpAfterB, `WorldManager lưu trữ HP dùng chung chính xác: ${expectedHpAfterB}`);
    });

    // ========================================================================
    // PHẦN 3: TIÊU DIỆT QUÁI (KILL) & TARGET INVALIDATION
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 3] MONSTER KILL & TARGET INVALIDATION FOR OTHER PLAYERS ---${colors.reset}`);

    await runTest('3.1: Player B giết quái -> Quái biến mất khỏi WorldManager, Player A không còn target và không thấy quái sống', async () => {
      // Đặt 1 quái vật fixture có HP thấp (10 HP) để Player B hạ gục ngay trong 1 đòn
      const monsterId = 999952;
      const monsterFixture = {
        id: monsterId,
        mid: 1,
        name: 'Dying Poring',
        lv: 1,
        hp: 10,
        hp_max: 100,
        x: 1010,
        y: 1000,
        spot_id: 1,
        spot_cx: 1000,
        spot_cy: 1000,
        spot_radius: 300
      };

      worldManager.maps[1].monsters = [monsterFixture];

      resetPlayerState(mockLineUidA, { x: 1000, y: 1000, target_monster_id: monsterId });
      resetPlayerState(mockLineUidB, { x: 1020, y: 1000, target_monster_id: monsterId });

      // Player B tấn công và kết liễu quái
      const resB = await callGamePlayer(mockLineUidB, mockTokenB, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resB.ok, 1, 'Player B request thành công');
      const killEventB = (resB.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      assert(killEventB, 'Player B phải có event kill quái 999952');
      assert.strictEqual(resB.target_monster_id, null, 'Player B sau khi diệt quái phải có target_monster_id = null');

      // Xác nhận quái đã bị xóa hoàn toàn khỏi WorldManager
      const monInWorldAfterKill = worldManager.getMonster(1, monsterId);
      assert.strictEqual(monInWorldAfterKill, null, 'Quái vật phải bị xóa khỏi WorldManager sau khi bị tiêu diệt');

      // Player A gửi tick tiếp theo (trước đó đang target 999952)
      const resA = await callGamePlayer(mockLineUidA, mockTokenA, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resA.ok, 1, 'Player A request thành công');

      // 1. Quái 999952 không còn xuất hiện trong danh sách monsters của Player A
      const monInResA = (resA.monsters || []).find(m => m.id === monsterId);
      assert.strictEqual(monInResA, undefined, 'Player A không được nhìn thấy quái đã chết trong danh sách monsters');

      // 2. target_monster_id của Player A phải được reset về null
      assert.strictEqual(resA.target_monster_id, null, `Target của Player A phải được reset về null khi quái bị người khác giết (thực tế: ${resA.target_monster_id})`);

      // 3. Player A không nhận event kill nào cho quái 999952
      const killEventA = (resA.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      assert.strictEqual(killEventA, undefined, 'Player A không được nhận event kill cho quái đã chết');
    });

    // ========================================================================
    // PHẦN 4: ATOMIC KILL REWARD — KHÔNG DUPLICATE REWARD/DROP CHO CÙNG 1 KILL
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 4] ATOMIC KILL REWARDS & NO DUPLICATE DROPS ---${colors.reset}`);

    await runTest('4.1: Hai người chơi cùng đánh 1 quái sắp chết -> Chỉ người kết liễu nhận phần thưởng (Atomic 1 Kill Reward)', async () => {
      const monsterId = 999953;
      const monsterLv = 3;
      const expectedExp = monsterLv * 1500 + 10;
      const expectedGold = monsterLv * 500 + 15;

      const monsterFixture = {
        id: monsterId,
        mid: 1,
        name: 'Contested Poring',
        lv: monsterLv,
        hp: 5, // Chỉ cần 1 hit bất kỳ là chết
        hp_max: 200,
        x: 1010,
        y: 1000,
        spot_id: 1,
        spot_cx: 1000,
        spot_cy: 1000,
        spot_radius: 300
      };

      worldManager.maps[1].monsters = [monsterFixture];

      resetPlayerState(mockLineUidA, { exp: 0, gold: 1000 });
      resetPlayerState(mockLineUidB, { exp: 0, gold: 1000 });

      // Player A gửi tick trước và kết liễu quái
      const resA = await callGamePlayer(mockLineUidA, mockTokenA, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resA.ok, 1, 'Player A tick thành công');
      const killEventA = (resA.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      assert(killEventA, 'Player A phải nhận event kill vì là người kết liễu');

      // Player A nhận thưởng EXP và Gold
      assert.strictEqual(resA.player.exp, expectedExp, `Player A phải nhận đúng ${expectedExp} EXP`);
      assert.strictEqual(resA.player.gold, 1000 + expectedGold, `Player A phải nhận đúng ${expectedGold} Gold`);

      // Player B gửi tick ngay sau đó, cùng nhắm vào monsterId 999953
      const resB = await callGamePlayer(mockLineUidB, mockTokenB, {
        lock_pos: 1,
        target_monster_id: monsterId
      });

      assert.strictEqual(resB.ok, 1, 'Player B tick thành công');
      const killEventB = (resB.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      assert.strictEqual(killEventB, undefined, 'Player B KHÔNG được nhận event kill cho quái đã bị Player A tiêu diệt');

      // Player B KHÔNG nhận thêm EXP hoặc Gold nào từ quái này
      assert.strictEqual(resB.player.exp, 0, 'Player B phải có EXP = 0 (không nhận thưởng lặp)');
      assert.strictEqual(resB.player.gold, 1000, 'Player B phải giữ nguyên 1000 Gold (không nhận thưởng lặp)');

      // Kiểm tra DB trực tiếp: Tổng EXP và Gold giữa 2 player phải chỉ tăng đúng 1 lần kill duy nhất
      const rowA = db.prepare('SELECT exp, gold FROM players WHERE line_uid = ?').get(mockLineUidA);
      const rowB = db.prepare('SELECT exp, gold FROM players WHERE line_uid = ?').get(mockLineUidB);

      assert.strictEqual(rowA.exp, expectedExp, `DB Player A EXP phải là ${expectedExp}`);
      assert.strictEqual(rowB.exp, 0, 'DB Player B EXP phải là 0');
      assert.strictEqual(rowA.gold + rowB.gold, 2000 + expectedGold, `Tổng Gold DB chỉ tăng đúng ${expectedGold} Gold`);
    });

    await runTest('4.2: Không sinh duplicate drops/items khi nhiều người chơi cùng gửi request', async () => {
      const monsterId = 999954;
      const monsterFixture = {
        id: monsterId,
        mid: 27, // Vua cây bóng tối (MVP Lv.20)
        name: 'Vua cây bóng tối',
        lv: 20,
        hp: 5,
        hp_max: 5000,
        x: 1010,
        y: 1000,
        is_mvp: true,
        mvp: 1,
        spot_id: 1,
        spot_cx: 1000,
        spot_cy: 1000,
        spot_radius: 300
      };

      worldManager.maps[1].monsters = [monsterFixture];

      resetPlayerState(mockLineUidA, { exp: 0, gold: 1000, drop_log: '[]' });
      resetPlayerState(mockLineUidB, { exp: 0, gold: 1000, drop_log: '[]' });

      // Mock random để đảm bảo 100% rớt drop cho người kết liễu
      const mockRandomHits = [
        0.5, // damage variance
        0.0001, // resource drop chance
        0, // chosenRes index (wood)
        0.00001, // blue diamond
        0.00001, // card drop chance
        0.00001  // egg drop chance
      ];

      // Player A kết liễu với mock random
      const resA = await callGamePlayer(mockLineUidA, mockTokenA, {
        lock_pos: 1,
        target_monster_id: monsterId
      }, mockRandomHits);

      assert.strictEqual(resA.ok, 1);
      const killA = (resA.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      assert(killA, 'Player A là người kết liễu');

      // Player B gửi tick ngay sau đó
      const resB = await callGamePlayer(mockLineUidB, mockTokenB, {
        lock_pos: 1,
        target_monster_id: monsterId
      }, mockRandomHits);

      assert.strictEqual(resB.ok, 1);
      assert.strictEqual((resB.events || []).find(e => e.type === 'kill'), undefined, 'Player B không có kill event');
      assert.strictEqual(resB.drop_fx.length, 0, 'Player B không có drop_fx');

      // Đối chiếu drop_log của Player B trong DB
      const rowB = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockLineUidB);
      const rawB = JSON.parse(rowB.raw_data);
      const dropLogB = typeof rawB.drop_log === 'string' ? JSON.parse(rawB.drop_log || '[]') : (rawB.drop_log || []);
      assert.strictEqual(dropLogB.length, 0, 'Player B drop_log phải rỗng');
    });

    await runTest('4.3: Ticks cạnh tranh đồng thời (Promise.all) -> Chính xác 1 người nhận kill reward', async () => {
      const monsterId = 999955;
      const monsterLv = 5;
      const expectedExp = monsterLv * 1500 + 10;
      const expectedGold = monsterLv * 500 + 15;

      const monsterFixture = {
        id: monsterId,
        mid: 1,
        name: 'Simultaneous Target Poring',
        lv: monsterLv,
        hp: 5,
        hp_max: 200,
        x: 1010,
        y: 1000,
        spot_id: 1,
        spot_cx: 1000,
        spot_cy: 1000,
        spot_radius: 300
      };

      worldManager.maps[1].monsters = [monsterFixture];

      resetPlayerState(mockLineUidA, { exp: 0, gold: 1000 });
      resetPlayerState(mockLineUidB, { exp: 0, gold: 1000 });

      // Cả 2 player cùng bắn request đồng thời cạnh tranh kill quái 999955
      const [resA, resB] = await Promise.all([
        callGamePlayer(mockLineUidA, mockTokenA, { lock_pos: 1, target_monster_id: monsterId }, null, false),
        callGamePlayer(mockLineUidB, mockTokenB, { lock_pos: 1, target_monster_id: monsterId }, null, false)
      ]);

      assert.strictEqual(resA.ok, 1, 'Player A tick thành công');
      assert.strictEqual(resB.ok, 1, 'Player B tick thành công');

      const killA = (resA.events || []).find(e => e.type === 'kill' && e.mid === monsterId);
      const killB = (resB.events || []).find(e => e.type === 'kill' && e.mid === monsterId);

      // Đúng một trong hai người phải có kill event (XOR)
      const killCount = (killA ? 1 : 0) + (killB ? 1 : 0);
      assert.strictEqual(killCount, 1, `Chính xác 1 player nhận kill event (thực tế A=${!!killA}, B=${!!killB})`);

      // Tổng EXP giữa 2 player trong DB phải đúng bằng 1 lần kill duy nhất
      const rowA = db.prepare('SELECT exp, gold FROM players WHERE line_uid = ?').get(mockLineUidA);
      const rowB = db.prepare('SELECT exp, gold FROM players WHERE line_uid = ?').get(mockLineUidB);

      assert.strictEqual(rowA.exp + rowB.exp, expectedExp, `Tổng EXP chỉ tăng đúng ${expectedExp} EXP cho 1 kill`);
      assert.strictEqual(rowA.gold + rowB.gold, 2000 + expectedGold, `Tổng Gold chỉ tăng đúng ${expectedGold} Gold cho 1 kill`);
    });

  } finally {
    // ========================================================================
    // CLEANUP FIXTURES
    // ========================================================================
    console.log(`\n${colors.bright}${colors.magenta}🧹 Đang dọn dẹp dữ liệu kiểm thử multiplayer (Cleanup)...${colors.reset}`);
    try {
      db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUidA);
      db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUidA);
      db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUidB);
      db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUidB);

      if (worldManager.maps[1]) {
        worldManager.maps[1].monsters = originalMonsters;
      }
      console.log(`  ✓ Đã dọn dẹp sạch sẽ 2 test players và khôi phục quái vật Map 1.`);
    } catch (cleanupErr) {
      console.error('  ⚠️ Lỗi trong quá trình dọn dẹp:', cleanupErr);
    }
  }
}

// Chạy test runner
runTestSuite().then(() => {
  console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bright}TỔNG KẾT KIỂM THỬ SHARED HP & MULTIPLAYER: ${passedTests}/${totalTests} tests thành công${colors.reset}`);
  if (failedTests > 0) {
    console.log(`${colors.bright}${colors.red}CÓ ${failedTests} TEST THẤT BẠI!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.bright}${colors.green}TẤT CẢ TEST SHARED HP & MULTIPLAYER ĐẠT CHUẨN XUẤT SẮC!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ Lỗi không xử lý được trong test runner:', err);
  process.exit(1);
});
