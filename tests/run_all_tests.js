const { spawnSync } = require('child_process');
const path = require('path');
const db = require('../server/db/queries');

const TEST_FILES = [
  // 1. Core Engine & Game Loop (9 tests)
  'test_auth_security.js',
  'test_core_game_loop.js',
  'test_drop_luk_system.js',
  'test_4_skill_trees.js',
  'test_airship_mining.js',
  'test_explore_radius.js',
  'test_lock_attack.js',
  'test_reconnect_map_reset.js',
  'test_shared_hp_multiplayer.js',

  // 2. P0 Systems (3 tests)
  'test_market_system.js',
  'test_trade_system.js',
  'test_upgrade_system.js',

  // 3. P1 Systems (7 tests)
  'test_chat_system.js',
  'test_chat_image_storage.js',
  'test_offline_system.js',
  'test_offline_persistence.js',
  'test_pvp_system.js',
  'test_raid_system.js',
  'test_arena_system.js',
  'test_cwar_system.js',

  // 4. P2 Systems (4 tests)
  'test_guild_system.js',
  'test_gwar_system.js',
  'test_admin_system.js',
  'test_logout_system.js',

  // 5. Endpoint Coverage & 501 Backlog Contract (1 test)
  'test_endpoint_coverage.js',

  // 6. HTTP Integration Smoke Test (TASK-039) (1 test)
  'test_http_smoke.js',

  // 7. Sensitive Request Logging Redaction (TASK-040) (1 test)
  'test_redact_logging.js',

  // 8. Client-Server API Contract Audit (TASK-041) (1 test)
  'test_api_contract.js',

  // 9. Gacha System Server-Authoritative (TASK-042) (1 test)
  'test_gacha_system.js',

  // 10. Auction System Server-Authoritative (TASK-043) (1 test)
  'test_auction_system.js',

  // 11. Orion Space Expedition Server-Authoritative (TASK-044) (1 test)
  'test_orion_raid_system.js',

  // 12. JSON Database Production Hardening (TASK-047) (1 test)
  'test_database_hardening.js',

  // 13. Browser Playtest & Release QA (TASK-048) (1 test)
  'test_browser_playtest.js'
];

function runMasterTestMatrix() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU CHẠY MA TRẬN KIỂM THỬ HỒI QUY TOÀN BỘ HỆ THỐNG');
  console.log(`📋 Tổng số bộ kiểm thử: ${TEST_FILES.length} Test Suites`);
  console.log('================================================================\n');

  const startTime = Date.now();
  let passedCount = 0;
  let failedCount = 0;
  const results = [];

  for (let i = 0; i < TEST_FILES.length; i++) {
    const file = TEST_FILES[i];
    const filePath = path.join(__dirname, file);
    const label = `[${i + 1}/${TEST_FILES.length}] ${file}`;
    process.stdout.write(`⏳ Đang chạy ${label}... `);

    const testStart = Date.now();
    const child = spawnSync(process.execPath, [filePath], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env, { ADMIN_API_KEY: 'test_admin_secret_key' }),
      encoding: 'utf8'
    });
    const duration = ((Date.now() - testStart) / 1000).toFixed(2);

    if (child.status === 0) {
      passedCount++;
      console.log(`✅ PASS (${duration}s)`);
      results.push({ file, status: 'PASS', duration });
    } else {
      failedCount++;
      console.log(`❌ FAIL (${duration}s)`);
      console.error(`\n--- LỖI TẠI ${file} ---`);
      console.error(child.stderr || child.stdout);
      console.error('---------------------------\n');
      results.push({ file, status: 'FAIL', duration, error: child.stderr || child.stdout });
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n================================================================');
  console.log('📊 KẾT QUẢ TỔNG HỢP MA TRẬN KIỂM THỬ (RELEASE READINESS)');
  console.log('================================================================');
  console.log(`✅ Tổng số Test Suite PASS: ${passedCount}/${TEST_FILES.length} (${((passedCount / TEST_FILES.length) * 100).toFixed(1)}%)`);
  console.log(`❌ Tổng số Test Suite FAIL: ${failedCount}/${TEST_FILES.length}`);
  console.log(`⏱️ Tổng thời gian thực thi: ${totalDuration}s`);
  console.log('================================================================\n');

  // Kiểm tra độ sạch sẽ của cơ sở dữ liệu
  db.load();
  let leftoverUsers = (db.data.users || []).filter(u => u.line_uid && (u.line_uid.startsWith('test_') || u.line_uid.startsWith('tok_')));
  let leftoverPlayers = (db.data.players || []).filter(p => p.line_uid && (p.line_uid.startsWith('test_') || p.line_uid.startsWith('tok_')));
  let leftoverGuilds = (db.data.guilds || []).filter(g => g.id && g.id.startsWith('test_'));

  if (leftoverUsers.length > 0 || leftoverPlayers.length > 0 || leftoverGuilds.length > 0) {
    console.warn(`⚠️ Phát hiện dữ liệu test rác chưa dọn: Users=${leftoverUsers.length}, Players=${leftoverPlayers.length}, Guilds=${leftoverGuilds.length}`);
    db.data.users = (db.data.users || []).filter(u => !u.line_uid || (!u.line_uid.startsWith('test_') && !u.line_uid.startsWith('tok_')));
    db.data.players = (db.data.players || []).filter(p => !p.line_uid || (!p.line_uid.startsWith('test_') && !p.line_uid.startsWith('tok_')));
    db.data.guilds = (db.data.guilds || []).filter(g => !g.id || !g.id.startsWith('test_'));
    db.save();
    console.log('🧹 Đã dọn dẹp cưỡng chế toàn bộ dữ liệu test rác thành công!');
  } else {
    console.log('✨ Cơ sở dữ liệu database.json sạch sẽ 100% (0 bản ghi test rác).');
  }

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMasterTestMatrix();
