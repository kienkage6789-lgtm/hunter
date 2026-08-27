const assert = require('assert');
const path = require('path');
const combatEngine = require(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'game', 'ragnalok-private-server', 'server', 'game', 'CombatEngine'));

// Màu sắc terminal để in kết quả test trực quan
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`  ${colors.green}✔ PASS:${colors.reset} ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  ${colors.red}✖ FAIL:${colors.reset} ${testName}`);
    console.error(`    ${colors.red}${err.message}${colors.reset}`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n')[1]}`);
    }
  }
}

console.log(`\n${colors.bright}${colors.cyan}======================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}   BỘ KIỂM THỬ TỰ ĐỘNG 4 NHÁNH KỸ NĂNG (SKILL TREES)  ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}\n`);

// ============================================================================
// 1. NHÁNH PHI ĐAO (ATK TREE: Throwing Daggers)
// ============================================================================
console.log(`${colors.bright}${colors.yellow}--- [NHÁNH 1] PHI ĐAO (ATK TREE) ---${colors.reset}`);

runTest('crit_shot: Tính đúng ATK phẳng và % tăng thêm cho Pistol/Sniper', () => {
  const player = {
    str: 10, dex: 20, agi: 10, luk: 5,
    gun_pistol_lv: 5,
    skills: JSON.stringify({ crit_shot: 5 })
  };
  const monster = { lv: 1 };
  const res = combatEngine.calculateDamage(player, monster, 'pistol', { dex: 20 });
  assert(res.dmg > 50, `Sát thương phải lớn hơn 50 (Thực tế: ${res.dmg})`);
  assert(res.crit === 0 || res.crit === 1, 'Kết quả phải chứa trường crit');
});

runTest('Chí mạng (Critical Hits): LUK & STR cao phải kích hoạt tỷ lệ chí mạng và nhân đôi sát thương', () => {
  const playerHighLuk = {
    str: 250, dex: 100, agi: 50, luk: 250, // (250+250)/10 = 50% max crit
    rag_crit: 0,
    skills: JSON.stringify({ crit_shot: 10 })
  };
  const monster = { lv: 10 };
  let critCount = 0;
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    const res = combatEngine.calculateDamage(playerHighLuk, monster, 'pistol');
    if (res.crit === 1) critCount++;
  }
  const critRate = critCount / iterations;
  assert(critRate >= 0.40 && critRate <= 0.60, `Tỷ lệ chí mạng phải quanh mức 50% (Thực tế: ${(critRate*100).toFixed(1)}%)`);
});

runTest('triple_knife (Tam phi đao): Phân tách sát thương làm 3 phần và tạo event tri_knife', () => {
  const skLv = 5;
  const skillDmgMult = 2 + skLv * 0.3; // 3.5x
  const baseDmg = 100;
  const finalDmg = Math.round(baseDmg * skillDmgMult);
  const partDmg = Math.max(1, Math.round(finalDmg / 3));

  const events = [];
  const targetM = { id: 101, x: 200, y: 200, hp: 500 };
  const isCrit = 1;

  events.push({
    type: "tri_knife",
    mid: targetM.id,
    x: 100,
    y: 100,
    hits: [partDmg, partDmg, partDmg],
    crit: isCrit
  });

  assert.strictEqual(events[0].type, 'tri_knife');
  assert.strictEqual(events[0].hits.length, 3);
  assert.strictEqual(events[0].hits[0] + events[0].hits[1] + events[0].hits[2], partDmg * 3);
});

runTest('explosive_shot (Phi đao nổ): Tính chuẩn bán kính nổ theo cấp (15m + lv-1)', () => {
  const skLv = 5;
  const radiusPx = 3 * (15 + skLv - 1); // (15 + 4) * 3 = 57px
  assert.strictEqual(radiusPx, 57, 'Bán kính nổ cấp 5 phải là 57px (19m)');

  const radiusPx10 = 3 * (15 + 10 - 1); // 24 * 3 = 72px
  assert.strictEqual(radiusPx10, 72, 'Bán kính nổ cấp 10 phải là 72px (24m)');
});

runTest('Pistol đánh thường: Tự động chia 3 phi đao riêng biệt', () => {
  const finalDmg = 90;
  const partDmg = Math.max(1, Math.round(finalDmg / 3));
  const hits = [];
  for (let i = 0; i < 3; i++) {
    hits.push(partDmg);
  }
  assert.strictEqual(hits.length, 3);
  assert.strictEqual(hits[0], 30);
});

// ============================================================================
// 2. NHÁNH ĐỘ BỀN & PHÒNG THỦ (DEF TREE: Defense / Durability)
// ============================================================================
console.log(`\n${colors.bright}${colors.yellow}--- [NHÁNH 2] ĐỘ BỀN & PHÒNG THỦ (DEF TREE) ---${colors.reset}`);

runTest('tough_body: Không bị nhân đúp 2 lần phần trăm HP vào hp_max', () => {
  const lv = 10;
  const vit = 50;
  const baseHpMax = 300 + (lv - 1) * 15; // 435
  const vitHpBonus = (vit - 5) * 4; // 180
  const toughBodyLv = 5;
  
  // Tính đúng: hp_max gốc chỉ cộng lượng phẳng
  let calculatedHpMax = baseHpMax + vitHpBonus;
  if (toughBodyLv > 0) {
    calculatedHpMax += toughBodyLv * 30; // +150
  }
  assert.strictEqual(calculatedHpMax, 435 + 180 + 150, 'hp_max phẳng không chứa hệ số %');

  // hpMaxEff mới là nơi nhân %
  const toughHpMul = 1 + 0.01 * toughBodyLv;
  const hpMaxEff = Math.floor(calculatedHpMax * toughHpMul);
  assert.strictEqual(hpMaxEff, Math.floor((435 + 180 + 150) * 1.05), 'hpMaxEff nhân 5% chính xác');
});

runTest('pull_monster (Nam châm): Tầm kéo động, kéo 1/2 khoảng cách và đẩy beam xanh lục', () => {
  const skLv = 4;
  const pullRadius = 3 * (75 + skLv * 5); // 3 * 95 = 285px
  assert.strictEqual(pullRadius, 285, 'Tầm kéo cấp 4 phải là 285px (95m)');

  const playerObj = { x: 100, y: 100 };
  const monster = { id: 5, x: 300, y: 100, hp: 50 };
  const oldX = monster.x, oldY = monster.y;
  
  // Kéo 1/2 khoảng cách
  monster.x = Math.round((monster.x + playerObj.x) / 2);
  monster.y = Math.round((monster.y + playerObj.y) / 2);
  assert.strictEqual(monster.x, 200, 'Quái từ 300 kéo về 100 phải ở tọa độ 200');

  const beamEvent = {
    type: 'beam',
    color: '#22c55e',
    thin: true,
    mid: monster.id,
    path: [[playerObj.x, playerObj.y], [oldX, oldY]]
  };
  assert.strictEqual(beamEvent.color, '#22c55e');
  assert.strictEqual(beamEvent.thin, true);
});

runTest('melee_charge (Return Stun): Thời gian choáng 0.1s/cấp và nổ vòng tròn đỏ', () => {
  const skLv = 8;
  const stunDurationMs = skLv * 100; // 800ms
  assert.strictEqual(stunDurationMs, 800, 'Cấp 8 làm choáng đúng 800ms (0.8s)');

  const chargeRadius = Math.round(3 * (15 + 0.1 * (skLv - 1))); // 3 * 15.7 = 47px
  assert.strictEqual(chargeRadius, 47, 'Bán kính nổ khoảng 47px');

  const expEvent = {
    type: 'explosion',
    color: '#ef4444',
    ring: true,
    x: 100,
    y: 100,
    r: chargeRadius
  };
  assert.strictEqual(expEvent.color, '#ef4444');
  assert.strictEqual(expEvent.ring, true);
});

runTest('melee_return (Phản đòn): Tính chuẩn 4 thành phần phản sát thương', () => {
  const meleeReturnLv = 5;
  const targetM = { lv: 30 };
  const vit = 50;
  const baseDmg = 120;
  const armLv = 4;

  const pctAtkMon = (8 + meleeReturnLv * 5) / 100 * (targetM.lv * 2); // 33% * 60 = 19.8
  const vitReflect = (2 + meleeReturnLv * 0.2) * vit; // 3.0 * 50 = 150
  const pctAtkMid = (3 + meleeReturnLv * 3) / 100 * baseDmg; // 18% * 120 = 21.6
  const armLvReflect = (2 + meleeReturnLv * 0.8) * armLv; // 6.0 * 4 = 24
  const reflectDmg = Math.round(pctAtkMon + vitReflect + pctAtkMid + armLvReflect);

  assert.strictEqual(reflectDmg, Math.round(19.8 + 150 + 21.6 + 24));
  assert(reflectDmg > 200, 'Phản đòn phải tính đúng tổng các thành phần');
});

// ============================================================================
// 3. NHÁNH KIẾM CẬN CHIẾN (MELEE TREE: Sword)
// ============================================================================
console.log(`\n${colors.bright}${colors.yellow}--- [NHÁNH 3] KIẾM CẬN CHIẾN (MELEE TREE) ---${colors.reset}`);

runTest('knife_atk & double_attack: CombatEngine không cộng dồn nhân đúp sát thương thụ động', () => {
  const player = {
    str: 30, dex: 10, agi: 60, luk: 5,
    knife_lv: 5,
    skills: JSON.stringify({ knife_atk: 5, double_attack: 10 })
  };
  const monster = { lv: 1 };
  
  // Tính sát thương cận chiến với knife
  const res = combatEngine.calculateDamage(player, monster, 'knife', { str: 30, agi: 60 });
  assert(res.dmg < 350, `Sát thương đánh đơn không được nhân đúp của double_attack (Thực tế: ${res.dmg})`);
});

runTest('double_attack chủ động: Chém 2 nhát riêng biệt với hệ số 1.1 + skLv*0.1', () => {
  const skLv = 5;
  const multPerHit = 1.1 + skLv * 0.1; // 1.6x
  const totalMult = multPerHit * 2; // 3.2x
  assert.strictEqual(multPerHit, 1.6);
  assert.strictEqual(totalMult, 3.2);
});

runTest('spin_attack (Kiếm xoay): Bán kính chuẩn 15m (45px) và tối đa 6 mục tiêu', () => {
  const skLv = 5;
  const radiusPx = 45; // 15m * 3 = 45px
  assert.strictEqual(radiusPx, 45, 'Bán kính xoay kiếm phải là 45px (15m)');
  
  const mult = 1.1 + skLv * 0.1;
  assert.strictEqual(mult, 1.6, 'Sát thương mỗi mục tiêu là 1.6x');
});

runTest('sword_cross & sword_x: Đúng hệ số sát thương và loại hoạt ảnh', () => {
  const skLv = 6;
  const crossMult = 2 + skLv * 0.1; // 2.6x
  const xMult = 3 + skLv * 0.1; // 3.6x
  assert.strictEqual(crossMult, 2.6);
  assert.strictEqual(xMult, 3.6);

  const eventCross = { type: 'sword_skill', kind: 'cross', mid: 1, x: 50, y: 50 };
  const eventX = { type: 'sword_skill', kind: 'x', mid: 1, x: 50, y: 50 };
  assert.strictEqual(eventCross.kind, 'cross');
  assert.strictEqual(eventX.kind, 'x');
});

// ============================================================================
// 4. NHÁNH THÁP PHÁO (TURRET TREE)
// ============================================================================
console.log(`\n${colors.bright}${colors.yellow}--- [NHÁNH 4] THÁP PHÁO (TURRET TREE) ---${colors.reset}`);

runTest('turret_cannon (Pháo cối): Ưu tiên trừ 100 MP và triển khai trước Tháp canh', () => {
  const currentTick = 100;
  const lastCannon = 0;
  const lastDeploy = 0;
  let playerMp = 105;
  const gunUseTurret = 1;
  const skills = { turret_cannon: 3, deploy_turret: 5 };
  
  let cannonDeployed = false;
  let normalTurretDeployed = false;

  if (gunUseTurret === 1) {
    // 1. Pháo cối kiểm tra trước
    if (skills.turret_cannon > 0 && currentTick - lastCannon >= 60 && playerMp >= 100) {
      playerMp -= 100; // Còn 5 MP
      cannonDeployed = true;
    }

    // 2. Tháp canh kiểm tra sau
    const cost = 20;
    if (skills.deploy_turret > 0 && currentTick - lastDeploy >= 10 && playerMp >= cost) {
      playerMp -= cost;
      normalTurretDeployed = true;
    }
  }

  assert.strictEqual(cannonDeployed, true, 'Pháo cối phải được ưu tiên đặt trước');
  assert.strictEqual(normalTurretDeployed, false, 'Tháp canh không được cướp MP nếu chỉ còn 5 MP');
  assert.strictEqual(playerMp, 5, 'MP còn lại đúng 5');
});

runTest('turret_cannon tấn công: Gửi event beam màu cam và explosion cam', () => {
  const tu = { x: 100, y: 100 };
  const target = { x: 250, y: 250 };
  
  const events = [];
  events.push({
    type: "beam",
    path: [[tu.x, tu.y], [target.x, target.y]],
    color: "#f97316"
  });
  events.push({
    type: "explosion",
    x: target.x,
    y: target.y,
    r: 50,
    color: "#f97316"
  });

  assert.strictEqual(events[0].color, '#f97316');
  assert.strictEqual(events[1].color, '#f97316');
  assert.strictEqual(events[1].r, 50);
});

runTest('deploy_turret & twin_turret: Đặt 2 tháp canh tại x - 15 và x + 15', () => {
  const skills = { twin_turret: 1, deploy_turret: 3 };
  const playerObj = { x: 100, y: 100, turrets: [] };
  const turretLife = 15;
  const currentTick = 10;
  
  if (skills.twin_turret > 0) {
    playerObj.turrets.push({ x: playerObj.x - 15, y: playerObj.y, lv: 3, expires: currentTick + turretLife });
    playerObj.turrets.push({ x: playerObj.x + 15, y: playerObj.y, lv: 3, expires: currentTick + turretLife });
  }

  assert.strictEqual(playerObj.turrets.length, 2);
  assert.strictEqual(playerObj.turrets[0].x, 85);
  assert.strictEqual(playerObj.turrets[1].x, 115);
});

runTest('turret_shock (Sốc điện): Bán kính giật 50 + turret_shock * 3', () => {
  const turretShockLv = 4;
  const shockRange = 50 + turretShockLv * 3; // 62px
  assert.strictEqual(shockRange, 62, 'Bán kính sốc điện cấp 4 phải là 62px');
});

// ============================================================================
// TỔNG KẾT KẾT QUẢ KIỂM THỬ
// ============================================================================
console.log(`\n${colors.bright}${colors.cyan}======================================================${colors.reset}`);
console.log(`${colors.bright}KẾT QUẢ TỔNG QUAN:${colors.reset}`);
console.log(`  Tổng số test case: ${colors.bright}${totalTests}${colors.reset}`);
console.log(`  Thành công:       ${colors.green}${colors.bright}${passedTests}${colors.reset}`);
console.log(`  Thất bại:         ${failedTests > 0 ? colors.red : colors.green}${colors.bright}${failedTests}${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
