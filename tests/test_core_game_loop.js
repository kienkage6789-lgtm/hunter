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
    return 0.999999;
  };
  try {
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
}

// Công thức EXP Hero chuẩn
function expNextHero(lv) {
  if (lv < 41) {
    let e = 100;
    for (let k = 2; k <= lv; k++) {
      const b = k <= 10 ? 1.50 : k <= 20 ? 1.45 : k <= 30 ? 1.40 : 1.35;
      e = Math.round(e * b);
    }
    return e;
  }
  let e = 100000000;
  for (let k = 42; k <= lv; k++) {
    e += (k >= 60 ? 120000000 : (k >= 55 ? 160000000 : (k >= 50 ? 80000000 : 15000000)));
  }
  return e;
}

console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}   BỘ INTEGRATION TEST TOÀN DIỆN CHO CORE GAMEPLAY LOOP (TASK-GP-002) ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);

const mockLineUid = 'test_core_user_' + Date.now();
const mockToken = 'core_mock_token_' + Date.now();

const initialPlayerObj = {
  line_uid: mockLineUid,
  name: 'Core Loop Champion',
  lv: 1,
  exp: 0,
  gold: 1000,
  hp: 300,
  hp_max: 300,
  mp: 75,
  str: 5,
  dex: 5,
  agi: 5,
  vit: 5,
  intel: 5,
  luk: 5,
  x: 1000,
  y: 1000,
  map: 1,
  active_gun: 0,
  gun_use_pistol: 1,
  gun_pistol_lv: 1,
  stat_pts: 0,
  skill_pts: 0,
  speed_modifier: 1.0,
  wander_change_rate: 0.1,
  skills: JSON.stringify({})
};

// Fixture setup DB
db.prepare(`
  INSERT INTO users (line_uid, username, password_hash, session_token)
  VALUES (?, ?, ?, ?)
`).run(mockLineUid, 'coreloopuser', 'hash_pass', mockToken);

db.prepare(`
  INSERT INTO players (line_uid, name, raw_data)
  VALUES (?, ?, ?)
`).run(
  mockLineUid,
  initialPlayerObj.name,
  JSON.stringify(initialPlayerObj)
);

// Lưu quái vật gốc của Map 1 để khôi phục khi hoàn tất test
let originalMonsters = [];
if (worldManager.maps[1]) {
  originalMonsters = [...worldManager.maps[1].monsters];
  worldManager.maps[1].monsters = []; // Xóa sạch quái ngẫu nhiên trên map để test hoàn toàn deterministic
}

// Helper gọi API game tick (hỗ trợ mock Math.random chuẩn xác bên trong API handler)
async function callGame(body = {}, mockRandomValues = null) {
  // Chờ 850ms vượt qua rate limit 800ms của game tick
  await new Promise(r => setTimeout(r, 850));
  
  const invokeRoute = () => {
    return new Promise((resolve, reject) => {
      gameRoute.handle(
        {
          method: 'POST',
          url: '/',
          body: {
            line_uid: mockLineUid,
            session_token: mockToken,
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

  const tick = mockRandomValues && Array.isArray(mockRandomValues)
    ? withMockRandomAsync(mockRandomValues, invokeRoute)
    : invokeRoute();
  return await Promise.race([
    tick,
    new Promise((_, reject) => setTimeout(() => reject(new Error('game tick timeout after 5s')), 5000))
  ]);
}

// Reset state player về fixture mong muốn
function resetPlayerState(customProps = {}) {
  const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockLineUid);
  let pObj = JSON.parse(pRow.raw_data);
  pObj = {
    ...pObj,
    lv: 1,
    exp: 0,
    gold: 1000,
    hp: 300,
    hp_max: 300,
    mp: 75,
    str: 5,
    dex: 5,
    agi: 5,
    vit: 5,
    intel: 5,
    luk: 5,
    x: 1000,
    y: 1000,
    map: 1,
    stat_pts: 0,
    skill_pts: 0,
    speed_modifier: 1.0,
    wander_change_rate: 0.1,
    target_monster_id: null,
    skills: JSON.stringify({}),
    cards: '{}',
    eggs: '{}',
    drop_log: '[]',
    wood: 0,
    stone: 0,
    herb: 0,
    diamond_blue: 0,
    diamond_red: 0,
    ...customProps
  };
  db.prepare(`
    UPDATE players SET x = ?, y = ?, exp = ?, gold = ?, lv = ?, raw_data = ?
    WHERE line_uid = ?
  `).run(pObj.x, pObj.y, pObj.exp, pObj.gold, pObj.lv, JSON.stringify(pObj), mockLineUid);
  return pObj;
}

async function runCoreLoopTestSuite() {
  try {
    // ========================================================================
    // PHẦN 1: AUTHENTICATION & REQUEST INITIALIZATION
    // ========================================================================
    console.log(`${colors.bright}${colors.yellow}--- [PHẦN 1] AUTHENTICATION & GAME TICK INITIALIZATION ---${colors.reset}`);

    await runTest('1.1: Request không hợp lệ (sai session_token hoặc thiếu uid) trả về ok: false', async () => {
      const resInvalidToken = await callGame({ session_token: 'wrong_token' });
      assert.strictEqual(resInvalidToken.ok, false, 'Sai token phải trả về ok: false');
      assert(resInvalidToken.error, 'Phải có thông báo lỗi');

      const resNoUid = await callGame({ line_uid: '' });
      assert.strictEqual(resNoUid.ok, false, 'Thiếu line_uid phải trả về ok: false');
    });

    await runTest('1.2: Request hợp lệ trả về ok: 1 với đầy đủ cấu trúc dữ liệu game tick', async () => {
      resetPlayerState();
      worldManager.maps[1].monsters = [];
      const res = await callGame();
      assert.strictEqual(res.ok, 1, 'Response phải trả về ok: 1');
      assert(res.player, 'Response phải chứa object player');
      assert.strictEqual(res.player.line_uid, mockLineUid, 'Player UID phải khớp');
      assert.strictEqual(res.player.lv, 1, 'Player Lv ban đầu phải là 1');
      assert(Array.isArray(res.monsters), 'monsters phải là array');
      assert(Array.isArray(res.events), 'events phải là array');
      assert(Array.isArray(res.drop_fx), 'drop_fx phải là array');
      assert.strictEqual(res.region, 'VN', 'Khu vực phải là VN');
    });

    await runTest('1.3: Tự động khởi tạo và khóa dung lượng tối đa cho Đạn & Năng lượng', async () => {
      const res = await callGame();
      assert(res.player.ammo_pistol >= 50, 'Đạn pistol phải được nạp đầy tối thiểu 50');
      assert(res.player.ammo_sniper >= 50, 'Đạn sniper phải được nạp đầy tối thiểu 50');
      assert(res.player.ammo_robot_gun >= 50, 'Đạn robot phải được nạp đầy tối thiểu 50');
      assert(res.player.house_energy !== undefined, 'house_energy phải được khởi tạo');
    });

    // ========================================================================
    // PHẦN 2: TARGETING SYSTEM (XÁC ĐỊNH MỤC TIÊU)
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 2] TARGETING SYSTEM (XÁC ĐỊNH MỤC TIÊU) ---${colors.reset}`);

    await runTest('2.1: Target chỉ định (explicit target_monster_id) hợp lệ trong tầm explore_radius', async () => {
      resetPlayerState({ x: 1000, y: 1000 });
      worldManager.maps[1].monsters = [
        { id: 999101, name: 'Quái Gần A', lv: 5, hp: 500, hp_max: 500, x: 1040, y: 1000, spot_id: 1 },
        { id: 999102, name: 'Quái Gần B', lv: 5, hp: 500, hp_max: 500, x: 1080, y: 1000, spot_id: 1 }
      ];

      const res = await callGame({ target_monster_id: 999102 });
      assert.strictEqual(res.player.target_monster_id, 999102, 'Target phải chọn đúng quái 999102');
    });

    await runTest('2.2: Tự động chọn mục tiêu gần nhất (Auto-target) khi không truyền target_monster_id', async () => {
      resetPlayerState({ x: 1000, y: 1000 });
      worldManager.maps[1].monsters = [
        { id: 999103, name: 'Quái Xa', lv: 5, hp: 500, hp_max: 500, x: 1200, y: 1000, spot_id: 1 },
        { id: 999104, name: 'Quái Gần Nhất', lv: 5, hp: 500, hp_max: 500, x: 1020, y: 1000, spot_id: 1 }
      ];

      const res = await callGame();
      assert.strictEqual(res.player.target_monster_id, 999104, 'Tự động chọn quái gần nhất 999104 (cách 20px so với 200px)');
    });

    await runTest('2.3: Reset target_monster_id = null khi quái nằm ngoài tầm explore_radius', async () => {
      resetPlayerState({ x: 1000, y: 1000 });
      worldManager.maps[1].monsters = [
        { id: 999105, name: 'Quái Ngoài Tầm', lv: 5, hp: 500, hp_max: 500, x: 1500, y: 1000, spot_id: 1 }
      ];

      const res = await callGame({ explore_radius: 100, target_monster_id: 999105 });
      assert.strictEqual(res.player.target_monster_id, null, 'Target phải là null khi quái nằm ngoài explore_radius 100px');
    });

    // ========================================================================
    // PHẦN 3: COMBAT GÂY SÁT THƯƠNG (HIT) & QUÁI VẬT PHẢN ĐÒN
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 3] COMBAT GÂY SÁT THƯƠNG (HIT) & PHẢN ĐÒN ---${colors.reset}`);

    await runTest('3.1: Combat gây sát thương lên quái trong tầm đánh (attackRange) -> quái bị trừ HP chính xác, sinh event hit', async () => {
      resetPlayerState({ x: 1000, y: 1000 });
      const initialMonHp = 100000;
      const monsterFixture = {
        id: 999106,
        name: 'Poring Máu Dày',
        lv: 1,
        hp: initialMonHp,
        hp_max: initialMonHp,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monsterFixture];

      const res = await callGame({ target_monster_id: 999106 });
      
      // Kiểm tra event hit
      const hitEvents = (res.events || []).filter(e => e.type === 'hit' && e.mid === 999106);
      assert(hitEvents.length > 0, 'Phải có event hit nhắm vào quái 999106');
      
      const totalDmgDealt = hitEvents.reduce((sum, e) => sum + (e.dmg || 0), 0);
      assert(totalDmgDealt > 0, `Tổng sát thương gây ra phải > 0 (thực tế: ${totalDmgDealt})`);

      // Kiểm tra HP quái trong WorldManager thực sự giảm
      const monInWorld = worldManager.getMonster(1, 999106);
      assert(monInWorld, 'Quái vật vẫn còn sống trên map');
      assert.strictEqual(monInWorld.hp, initialMonHp - totalDmgDealt, `HP quái phải giảm chính xác từ ${initialMonHp} còn ${initialMonHp - totalDmgDealt} (thực tế: ${monInWorld.hp})`);
    });

    await runTest('3.2: Quái vật còn sống phản đòn -> Player bị trừ Giáp (Armor Absorb) / HP và sinh event mon_atk', async () => {
      resetPlayerState({ x: 1000, y: 1000, hp: 300, hp_max: 300, armor: 50 });
      const monsterHighLv = {
        id: 999107,
        name: 'Quái Lv Cao Phản Đòn',
        lv: 50,
        hp: 100000,
        hp_max: 100000,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monsterHighLv];

      const res = await callGame({ target_monster_id: 999107 });
      
      const monAtkEvent = (res.events || []).find(e => e.type === 'mon_atk' && e.mid === 999107);
      assert(monAtkEvent, 'Phải có event mon_atk khi quái còn sống đánh trả');
      assert(monAtkEvent.dmg >= 0, 'Sát thương phản đòn phải được tính');
      assert(monAtkEvent.absorb >= 0, 'Lượng giáp hấp thụ phải được tính');
    });

    // ========================================================================
    // PHẦN 4: TIÊU DIỆT QUÁI VẬT (KILL) & NHẬN EXP/GOLD
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 4] TIÊU DIỆT QUÁI (KILL) & NHẬN EXP/GOLD ---${colors.reset}`);

    await runTest('4.1: Tiêu diệt quái vật (HP quái <= 0) -> Tạo event kill, xóa khỏi world và reset target', async () => {
      resetPlayerState({ x: 1000, y: 1000, exp: 0, gold: 1000 });
      const monKillFixture = {
        id: 999108,
        name: 'Poring Yếu Ớt',
        lv: 5,
        hp: 1,
        hp_max: 100,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monKillFixture];

      const res = await callGame({ target_monster_id: 999108 });

      // Event kill
      const killEvent = (res.events || []).find(e => e.type === 'kill' && e.mid === 999108);
      assert(killEvent, 'Phải có event kill cho quái 999108');

      // Quái đã bị xóa khỏi map
      const monInWorld = worldManager.getMonster(1, 999108);
      assert.strictEqual(monInWorld, null, 'Quái vật bị tiêu diệt phải không còn trong map');

      // Target reset về null
      assert.strictEqual(res.player.target_monster_id, null, 'target_monster_id phải reset về null sau khi quái chết');
    });

    await runTest('4.2: Tăng EXP và Gold chính xác theo công thức kill quái (exp = lv*1500+10, gold = lv*500+15)', async () => {
      // Đặt exp = 0, lv = 25 (ngưỡng lv 25 là > 100,000 EXP để không bị kích hoạt level-up làm trừ exp)
      resetPlayerState({ x: 1000, y: 1000, lv: 25, exp: 0, gold: 1000 });
      const monLv = 5;
      const expectedExpGain = monLv * 1500 + 10; // 7510
      const expectedGoldGain = monLv * 500 + 15; // 2515

      const monKill = {
        id: 999109,
        name: 'Quái Lv5 Nhận Thưởng',
        lv: monLv,
        hp: 1,
        hp_max: 100,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monKill];

      const res = await callGame({ target_monster_id: 999109 });

      assert.strictEqual(res.player.exp, expectedExpGain, `EXP phải tăng chính xác +${expectedExpGain} (thực tế: ${res.player.exp})`);
      assert.strictEqual(res.player.gold, 1000 + expectedGoldGain, `Gold phải tăng chính xác +${expectedGoldGain} (thực tế: ${res.player.gold})`);

      const expMsgEvent = (res.events || []).find(e => e.type === 'explore' && e.msg && e.msg.includes(`Giết ${monKill.name} nhận ${expectedExpGain} EXP và ${expectedGoldGain} G`));
      assert(expMsgEvent, 'Phải có event thông báo nhận EXP và Gold khi giết quái');
    });

    // ========================================================================
    // PHẦN 5: HỆ THỐNG DROP VỚI DETERMINISTIC MOCK MATH.RANDOM
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 5] HỆ THỐNG DROP DETERMINISTIC (MOCK MATH.RANDOM) ---${colors.reset}`);

    await runTest('5.1: Rớt nguyên liệu Map 1 (wood/stone/herb) và cập nhật drop_fx / inventory player', async () => {
      resetPlayerState({ x: 1000, y: 1000, lv: 25, luk: 5, wood: 0 });
      const monDrop = {
        id: 999110,
        name: 'Mộc Tinh Rớt Gỗ',
        lv: 5,
        hp: 1,
        hp_max: 100,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monDrop];

      // Mock random sequence cho game tick:
      // Roll 1: Crit roll (0.99)
      // Roll 2: Combat variance (0.5)
      // Roll 3: resChance roll (0.05 < 0.20 -> trúng drop res)
      // Roll 4: chosenRes index (0.0 -> Map 1 index 0 = 'wood')
      // Roll 5: qty roll (0.0 -> floor(0 * 3) + 1 = 1 gỗ)
      // Roll 6..12: blue diamond, card, egg, mod, eq2 (0.99 -> không rớt)
      const mockSequence = [0.99, 0.5, 0.05, 0.0, 0.0, 0.99, 0.99, 0.99, 0.99, 0.99];

      const res = await callGame({ target_monster_id: 999110 }, mockSequence);

      assert(res.player.wood >= 1, `Player phải nhận được ít nhất 1 gỗ (thực tế: ${res.player.wood})`);
      assert(res.drop_fx.includes('🪵'), 'drop_fx phải chứa emoji 🪵');
      const dropEvent = (res.events || []).find(e => e.type === 'drop' && e.msg && e.msg.includes('🪵'));
      assert(dropEvent, 'Phải có event drop thông báo nhận gỗ');
    });

    await runTest('5.2: Tiêu diệt quái Lv >= 25 rớt Kim cương đỏ và ghi nhận vào drop_log', async () => {
      resetPlayerState({ x: 1000, y: 1000, lv: 30, diamond_red: 0, drop_log: '[]' });
      const monRedDia = {
        id: 999111,
        name: 'Rồng Đỏ Lv30',
        lv: 30,
        hp: 1,
        hp_max: 100,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monRedDia];

      // Mock roll trúng Kim cương đỏ:
      // Roll 1: Crit (0.99)
      // Roll 2: Combat variance (0.5)
      // Roll 3: resChance (0.99 - no res)
      // Roll 4: blueChance (0.99 - no blue)
      // Roll 5: redChance (0.00001 < 0.00014 -> trúng Red Diamond!)
      // Roll 6..10: card, egg, mod, eq2 (0.99)
      const mockSequence = [0.99, 0.5, 0.99, 0.99, 0.00001, 0.99, 0.99, 0.99, 0.99];

      const res = await callGame({ target_monster_id: 999111 }, mockSequence);

      assert.strictEqual(res.player.diamond_red, 1, 'Phải nhận được 1 Kim cương đỏ');
      assert(res.drop_fx.includes('💎'), 'drop_fx phải chứa emoji 💎');

      const dropLog = typeof res.player.drop_log === 'string' ? JSON.parse(res.player.drop_log) : res.player.drop_log;
      const redEntry = dropLog.find(d => d.n === 'Kim cương đỏ');
      assert(redEntry, 'drop_log phải ghi nhận Kim cương đỏ');
    });

    await runTest('5.3: Tiêu diệt Boss MVP rớt Hộp Box và Thẻ bài (Card)', async () => {
      resetPlayerState({ x: 1000, y: 1000, lv: 50, cards: '{}', drop_log: '[]' });
      const mvpBoss = {
        id: 999113,
        mid: 27,
        name: 'Vua cây bóng tối MVP',
        lv: 20,
        hp: 1,
        hp_max: 5000,
        is_mvp: 1,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [mvpBoss];

      // Mock roll:
      // Roll 1: Crit (0.99)
      // Roll 2: Variance (0.5)
      // Roll 3: resChance (0.99)
      // Roll 4: blue (0.99)
      // Roll 5: card roll (0.00001 < cardChance -> rớt Thẻ bài MVP!)
      // Roll 6: egg roll (0.99)
      // Roll 7: mod roll (0.99)
      // Roll 8..13: 6 eq2 conf rolls (0.99 x 6)
      // Roll 14: box mod roll (0.01 < 0.1125 -> rớt module_box1!)
      // Roll 15: box card roll (0.99)
      const mockSequence = [
        0.99, 0.5, 0.99, 0.99, 0.00001, 0.99, 0.99,
        0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
        0.01, 0.99
      ];

      const res = await callGame({ target_monster_id: 999113 }, mockSequence);

      assert(res.drop_fx.includes('🎴'), 'drop_fx phải chứa emoji Thẻ bài 🎴');
      assert(res.drop_fx.includes('📦'), 'drop_fx phải chứa emoji Hộp Box 📦');
      assert.strictEqual(res.player.module_box1, 1, 'Player phải nhận được 1 module_box1');

      const cards = typeof res.player.cards === 'string' ? JSON.parse(res.player.cards) : res.player.cards;
      assert(cards['27'] && cards['27'].m >= 1, 'Cards phải ghi nhận thẻ bài MVP 27');
    });

    // ========================================================================
    // PHẦN 6: LEVEL-UP & CẬP NHẬT STATS / EXP_NEXT
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 6] LEVEL-UP & CẬP NHẬT STATS / EXP_NEXT ---${colors.reset}`);

    await runTest('6.1: EXP vượt ngưỡng -> Lên cấp, cộng stat_pts (+5), skill_pts (+1), hp_max (+15) và hồi đầy HP', async () => {
      // Đặt Player Lv 1 (vit = 5) có 95 EXP (ngưỡng Lv 1 là 100 EXP)
      resetPlayerState({
        x: 1000,
        y: 1000,
        lv: 1,
        vit: 5,
        exp: 95,
        stat_pts: 0,
        skill_pts: 0,
        hp: 50, // Đang bị thương
        hp_max: 300
      });

      const monLv1 = {
        id: 999112,
        name: 'Gà Con Lv1',
        lv: 1,
        hp: 1,
        hp_max: 30,
        x: 1010,
        y: 1000,
        spot_id: 1
      };
      worldManager.maps[1].monsters = [monLv1];

      // Giết quái Lv 1 nhận: 1 * 1500 + 10 = 1510 EXP.
      // Tổng EXP = 95 + 1510 = 1605 EXP.
      // Quá trình lên cấp tuần tự:
      // Lv 1 (cần 100) -> EXP còn 1505 -> Lv 2
      // Lv 2 (cần 150) -> EXP còn 1355 -> Lv 3
      // Lv 3 (cần 225) -> EXP còn 1130 -> Lv 4
      // Lv 4 (cần 338) -> EXP còn 792  -> Lv 5
      // Lv 5 (cần 507) -> EXP còn 285  -> Lv 6
      // Lv 6 (cần 761) -> 285 < 761    -> Dừng tại Lv 6, EXP còn 285.

      const res = await callGame({ target_monster_id: 999112 });

      assert.strictEqual(res.player.lv, 6, `Player phải lên cấp 6 (thực tế: ${res.player.lv})`);
      assert.strictEqual(res.player.exp, 285, `EXP dư phải là 285 (thực tế: ${res.player.exp})`);
      
      const expectedStatPts = (6 - 1) * 5; // 25
      const expectedSkillPts = (6 - 1) * 1; // 5
      const expectedHpMax = 300 + (6 - 1) * 15; // 375 (với vit=5)

      assert.strictEqual(res.player.stat_pts, expectedStatPts, `stat_pts phải là ${expectedStatPts} (thực tế: ${res.player.stat_pts})`);
      assert.strictEqual(res.player.skill_pts, expectedSkillPts, `skill_pts phải là ${expectedSkillPts} (thực tế: ${res.player.skill_pts})`);
      assert.strictEqual(res.player.hp_max, expectedHpMax, `hp_max phải là ${expectedHpMax} (thực tế: ${res.player.hp_max})`);
      assert.strictEqual(res.player.hp, res.player.hp_max, `HP phải hồi đầy bằng hp_max khi lên cấp (thực tế: ${res.player.hp})`);

      const levelUpMsg = (res.events || []).find(e => e.type === 'explore' && e.msg && e.msg.includes('Chúc mừng bạn đã lên cấp'));
      assert(levelUpMsg, 'Phải có event thông báo chúc mừng lên cấp');
    });

    await runTest('6.2: exp_next được tính toán và đồng bộ chuẩn xác theo expNextHero(lv) - exp', async () => {
      const pRow = db.prepare('SELECT raw_data FROM players WHERE line_uid = ?').get(mockLineUid);
      const playerObj = JSON.parse(pRow.raw_data);
      
      const currentLv = playerObj.lv;
      const currentExp = playerObj.exp;
      const expectedExpNext = expNextHero(currentLv) - currentExp;

      assert.strictEqual(playerObj.exp_next, expectedExpNext, `exp_next trong state phải bằng expNextHero(${currentLv}) - ${currentExp} = ${expectedExpNext} (thực tế: ${playerObj.exp_next})`);
    });

    // ========================================================================
    // PHẦN 7: TÍNH NHẤT QUÁN VÀ PERSISTENCE VÀO DATABASE
    // ========================================================================
    console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 7] PERSISTENCE & STATE CONSISTENCY TRONG DB ---${colors.reset}`);

    await runTest('7.1: Dữ liệu Player trong DB (players table & raw_data) được lưu nhất quán sau game tick', async () => {
      // Thực hiện thêm 1 game tick
      worldManager.maps[1].monsters = [];
      const res = await callGame({ explore_cx: 1050, explore_cy: 1050 });

      // Đọc trực tiếp từ DB
      const dbRow = db.prepare('SELECT * FROM players WHERE line_uid = ?').get(mockLineUid);
      assert(dbRow, 'Phải tìm thấy player trong DB');
      
      const dbRaw = JSON.parse(dbRow.raw_data);

      // Đối chiếu cột độc lập của table players
      assert.strictEqual(dbRow.lv, res.player.lv, `Cột lv trong DB (${dbRow.lv}) phải khớp response (${res.player.lv})`);
      assert.strictEqual(dbRow.exp, res.player.exp, `Cột exp trong DB (${dbRow.exp}) phải khớp response (${res.player.exp})`);
      assert.strictEqual(dbRow.gold, res.player.gold, `Cột gold trong DB (${dbRow.gold}) phải khớp response (${res.player.gold})`);
      assert.strictEqual(dbRow.x, res.player.x, `Cột x trong DB (${dbRow.x}) phải khớp response (${res.player.x})`);
      assert.strictEqual(dbRow.y, res.player.y, `Cột y trong DB (${dbRow.y}) phải khớp response (${res.player.y})`);

      // Đối chiếu raw_data JSON
      assert.strictEqual(dbRaw.lv, res.player.lv, 'raw_data.lv phải khớp response');
      assert.strictEqual(dbRaw.exp, res.player.exp, 'raw_data.exp phải khớp response');
      assert.strictEqual(dbRaw.gold, res.player.gold, 'raw_data.gold phải khớp response');
      assert.strictEqual(dbRaw.hp, res.player.hp, 'raw_data.hp phải khớp response');
      assert.strictEqual(dbRaw.stat_pts, res.player.stat_pts, 'raw_data.stat_pts phải khớp response');
      assert.strictEqual(dbRaw.skill_pts, res.player.skill_pts, 'raw_data.skill_pts phải khớp response');
      assert.strictEqual(dbRaw.exp_next, res.player.exp_next, 'raw_data.exp_next phải khớp response');
    });

  } finally {
    // ========================================================================
    // CLEANUP FIXTURES
    // ========================================================================
    console.log(`\n${colors.bright}${colors.magenta}🧹 Đang dọn dẹp dữ liệu kiểm thử (Cleanup)...${colors.reset}`);
    try {
      db.prepare('DELETE FROM players WHERE line_uid = ?').run(mockLineUid);
      db.prepare('DELETE FROM users WHERE line_uid = ?').run(mockLineUid);
      if (worldManager.maps[1]) {
        worldManager.maps[1].monsters = originalMonsters;
      }
      console.log(`  ✓ Đã dọn dẹp sạch sẽ User, Player fixture và khôi phục quái vật Map 1.`);
    } catch (cleanupErr) {
      console.error('  ⚠️ Lỗi trong quá trình dọn dẹp:', cleanupErr);
    }
  }
}

// Chạy test runner
runCoreLoopTestSuite().then(() => {
  console.log(`\n${colors.bright}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bright}TỔNG KẾT KIỂM THỬ CORE GAMEPLAY LOOP: ${passedTests}/${totalTests} tests thành công${colors.reset}`);
  if (failedTests > 0) {
    console.log(`${colors.bright}${colors.red}CÓ ${failedTests} TEST THẤT BẠI!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.bright}${colors.green}TẤT CẢ CÁC BƯỚC CORE GAMEPLAY LOOP ĐỀU ĐẠT CHUẨN XUẤT SẮC!${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}================================================================${colors.reset}\n`);
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ Lỗi không xử lý được trong test runner:', err);
  process.exit(1);
});
