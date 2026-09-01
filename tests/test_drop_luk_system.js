const assert = require('assert');
const path = require('path');
const DropSystem = require(path.join(__dirname, '..', 'server', 'game', 'DropSystem'));

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
console.log(`${colors.bright}${colors.cyan}   BỘ KIỂM THỬ TỰ ĐỘNG CÔNG THỨC DROP & LUK (DROP SYSTEM)  ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}\n`);

// ============================================================================
// 1. KIỂM THỬ DROP MULTIPLIER THEO CÁC MỨC LUK
// ============================================================================
console.log(`${colors.bright}${colors.yellow}--- [PHẦN 1] HỆ SỐ NHÂN DROP (MULTIPLIER) THEO LUK ---${colors.reset}`);

runTest('LUK mặc định (= 5): Hệ số nhân cơ bản bằng 1.0', () => {
  const player = { luk: 5 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(mult, 1.0, `mult phải là 1.0 (Thực tế: ${mult})`);
});

runTest('LUK = 0: Không tạo giá trị âm hoặc sai lệch, hệ số nhân bằng 1.0', () => {
  const player = { luk: 0 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(mult, 1.0, `mult phải là 1.0 (Thực tế: ${mult})`);
});

runTest('LUK = 15: +1% drop rate (lukBonus = 0.01), hệ số nhân bằng 1.01', () => {
  const player = { luk: 15 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(Math.round(mult * 100) / 100, 1.01, `mult phải là 1.01 (Thực tế: ${mult})`);
});

runTest('LUK = 50: +5% drop rate (lukBonus = 0.05), hệ số nhân bằng 1.05 (không bị lỗi x10 phóng đại 500)', () => {
  const player = { luk: 50 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(Math.round(mult * 100) / 100, 1.05, `mult phải là 1.05 (Thực tế: ${mult})`);
});

runTest('LUK = 120: +12% drop rate (lukBonus = 0.12), hệ số nhân bằng 1.12', () => {
  const player = { luk: 120 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(Math.round(mult * 100) / 100, 1.12, `mult phải là 1.12 (Thực tế: ${mult})`);
});

runTest('Ưu tiên luk_eff khi có buff trang bị/kỹ năng', () => {
  const player = { luk: 5, luk_eff: 85 };
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(Math.round(mult * 100) / 100, 1.08, `mult phải dùng luk_eff=85 cho bonus 0.08 (Thực tế: ${mult})`);
});

runTest('Kết hợp Premium + VIP + Boost + LUK + Lucky Drop skill', () => {
  const future = (Date.now() / 1000) + 3600;
  const player = {
    premium_drop_expires: future, // +1.0
    premium_np_expires: future,   // +0.25
    premium_pk_expires: future,   // +0.25
    premium_pro_expires: future,  // +0.50
    vip_lv: 10,                   // +0.50
    luk: 100,                     // +0.10
    skills: JSON.stringify({ lucky_drop: 10 }) // +20% (x1.20)
  };
  // Base sum = 1.0 + 1.0 + 0.25 + 0.25 + 0.50 + 0.50 + 0.10 = 3.60
  // Multiplied by (1 + 0.20) = 3.60 * 1.2 = 4.32
  const mult = DropSystem.getDropMultiplier(player);
  assert.strictEqual(Math.round(mult * 1000) / 1000, 4.32, `mult phải là 4.32 (Thực tế: ${mult})`);
});

// ============================================================================
// 2. KIỂM THỬ TỶ LỆ RỚT NGUYÊN LIỆU (resChance)
// ============================================================================
console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 2] TỶ LỆ RỚT NGUYÊN LIỆU (resChance) ---${colors.reset}`);

runTest('resChance tại LUK mặc định (= 5): resChance = 0.20 (20%)', () => {
  const player = { luk: 5 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(Math.round(chance * 100) / 100, 0.20, `resChance phải là 0.20 (Thực tế: ${chance})`);
});

runTest('resChance tại LUK = 0: resChance = 0.15 (15%)', () => {
  const player = { luk: 0 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(Math.round(chance * 100) / 100, 0.15, `resChance phải là 0.15 (Thực tế: ${chance})`);
});

runTest('resChance tại LUK = 15: resChance = 0.30 (30%)', () => {
  const player = { luk: 15 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(Math.round(chance * 100) / 100, 0.30, `resChance phải là 0.30 (Thực tế: ${chance})`);
});

runTest('resChance tại LUK = 33: resChance = 0.48 (48% chạm trần)', () => {
  const player = { luk: 33 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(Math.round(chance * 100) / 100, 0.48, `resChance phải là 0.48 (Thực tế: ${chance})`);
});

runTest('resChance tại LUK cực cao (= 100): bị giới hạn trần ở 0.48 (không vượt 48%)', () => {
  const player = { luk: 100 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(Math.round(chance * 100) / 100, 0.48, `resChance phải bị trần ở 0.48 (Thực tế: ${chance})`);
});

runTest('resChance không bao giờ âm khi LUK âm bất thường', () => {
  const player = { luk: -50 };
  const chance = DropSystem.getResourceChance(player);
  assert.strictEqual(chance, 0.0, `resChance không được âm (Thực tế: ${chance})`);
});

// ============================================================================
// 3. KIỂM THỬ DETERMINISTIC END-TO-END GENERATEDROPS (MOCK MATH.RANDOM)
// ============================================================================
console.log(`\n${colors.bright}${colors.yellow}--- [PHẦN 3] DETERMINISTIC END-TO-END DROPS (MOCK RANDOM) ---${colors.reset}`);

function withMockRandom(mockValues, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    if (index < mockValues.length) {
      return mockValues[index++];
    }
    return 0.999999; // Giá trị an toàn mặc định không kích hoạt drop
  };
  try {
    fn();
  } finally {
    Math.random = originalRandom;
  }
}

runTest('Rớt nguyên liệu theo map: Map 1 rớt wood/stone/herb, tính gatherer skill', () => {
  const player = {
    luk: 5,
    skills: JSON.stringify({ gatherer: 5 }) // +50% qty
  };
  const monster = { lv: 10, is_mvp: 0 };
  
  // mock sequence:
  // 1. resChance roll: 0.10 (< 0.20 -> rớt)
  // 2. resource index roll: 0.0 -> Map 1: index 0 = 'wood'
  // 3. qty roll: 0.0 -> floor(0 * 3) + 1 = 1. With gatherer 5: round(1 * 1.5) = 2
  // 4.. rest rolls: 0.99 (không rớt gì thêm)
  withMockRandom([0.10, 0.0, 0.0], () => {
    const result = DropSystem.generateDrops(player, monster, 1);
    assert.strictEqual(player.wood, 2, `Phải nhận được 2 gỗ (Thực tế: ${player.wood})`);
    assert(result.drops.includes('🪵'), 'Drops phải chứa emoji gỗ');
  });
});

runTest('Rớt Kim cương đỏ khi đánh quái Lv >= 25', () => {
  const player = { luk: 5 };
  const monster = { lv: 30, is_mvp: 0 };

  // mock sequence:
  // 1. resChance roll: 0.99 (không rớt res)
  // 2. blue diamond roll: 0.99 (không rớt)
  // 3. red diamond roll: 0.00001 (< 0.00014 -> rớt red diamond)
  withMockRandom([0.99, 0.99, 0.00001], () => {
    const result = DropSystem.generateDrops(player, monster, 1);
    assert.strictEqual(player.diamond_red, 1, 'Phải nhận 1 kim cương đỏ');
    assert(result.drops.includes('💎'), 'Drops phải chứa emoji kim cương');
  });
});

runTest('Boss MVP rớt Hộp Box và Trang bị EQ2 khi roll trúng', () => {
  const player = { luk: 10 };
  const monster = { lv: 50, mid: 999, name: 'Baphomet', is_mvp: 1 };

  // mock sequence:
  // 1. resChance: 0.99
  // 2. blue diamond: 0.99
  // 3. red diamond: 0.99
  // 4. card roll: 0.99
  // 5. egg roll: 0.99
  // 6. mod roll: 0.99
  // 7. eq2 tier 1 roll: 0.05 (< 0.25 * 1.01 -> trúng T1)
  // 8. eq2 slot roll: 0.0 (head)
  // 9. eq2 affix stat: 0.0 (spd)
  // 10. eq2 affix val: 0.5 (val = 2)
  // 11. eq2 id random string: 0.123
  // 12. box mod roll: 0.01 (< 0.0675 -> trúng module_box3)
  // 13. box card roll: 0.99
  withMockRandom([
    0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
    0.05, 0.0, 0.0, 0.5, 0.123,
    0.01, 0.99
  ], () => {
    const result = DropSystem.generateDrops(player, monster, 1);
    assert.strictEqual(player.module_box3, 1, 'Phải nhận được 1 module_box3');
    assert(result.drops.includes('📦'), 'Drops phải chứa hộp box');
    assert(result.drops.includes('👑'), 'Drops phải chứa mũ eq2');
    
    const eq2Inv = JSON.parse(player.eq2_inv);
    assert.strictEqual(eq2Inv.length, 1);
    assert.strictEqual(eq2Inv[0].s, 'head');
    assert.strictEqual(eq2Inv[0].t, 1);
  });
});

runTest('An toàn drop_log: Không bị crash khi drop_log là chuỗi JSON hoặc array rỗng', () => {
  const player1 = { luk: 5, drop_log: "invalid json string {" };
  const monster = { lv: 10, is_mvp: 0 };
  const result1 = DropSystem.generateDrops(player1, monster, 1);
  assert(Array.isArray(JSON.parse(player1.drop_log)), 'drop_log phải được parse an toàn thành JSON array');

  const player2 = { luk: 5, drop_log: null };
  const result2 = DropSystem.generateDrops(player2, monster, 1);
  assert(Array.isArray(JSON.parse(player2.drop_log)), 'drop_log null phải được khởi tạo an toàn thành JSON array');
});

// ============================================================================
// TỔNG KẾT
// ============================================================================
console.log(`\n${colors.bright}${colors.cyan}======================================================${colors.reset}`);
console.log(`${colors.bright}KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} tests thành công${colors.reset}`);
if (failedTests > 0) {
  console.log(`${colors.bright}${colors.red}CÓ ${failedTests} TESTS THẤT BẠI!${colors.reset}`);
  process.exit(1);
} else {
  console.log(`${colors.bright}${colors.green}TẤT CẢ TEST ĐỀU ĐẠT CHUẨN XUẤT SẮC!${colors.reset}`);
  process.exit(0);
}
console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}\n`);
