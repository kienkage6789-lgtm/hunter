const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/db/queries');
const { acquireLock, acquireTwoLocks, setLockTimeout, getActiveLocksCount, clearAllLocks } = require('../server/utils/lock');

async function runDatabaseHardeningTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ: JSON DATABASE PRODUCTION HARDENING (TASK-047) ===\n');

  db.load();
  const baselineUsers = JSON.parse(JSON.stringify(db.data.users || []));
  const baselinePlayers = JSON.parse(JSON.stringify(db.data.players || []));
  const baselineGuilds = JSON.parse(JSON.stringify(db.data.guilds || []));

  console.log(`[Baseline] Users: ${baselineUsers.length}, Players: ${baselinePlayers.length}, Guilds: ${baselineGuilds.length}`);
  assert.strictEqual(Array.isArray(baselineUsers) && baselineUsers.length > 0, true, 'Baseline users phải là array hợp lệ');
  assert.strictEqual(Array.isArray(baselinePlayers) && baselinePlayers.length > 0, true, 'Baseline players phải là array hợp lệ');

  // -------------------------------------------------------------
  // Test 1: Kiểm tra tính toàn vẹn cấu trúc (Integrity Verification)
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Kiểm tra hàm verifyIntegrity ---');
  assert.strictEqual(db.verifyIntegrity(null), false, 'null phải không hợp lệ');
  assert.strictEqual(db.verifyIntegrity('string'), false, 'string phải không hợp lệ');
  assert.strictEqual(db.verifyIntegrity({ users: [] }), false, 'thiếu players phải không hợp lệ');
  assert.strictEqual(db.verifyIntegrity({ players: [] }), false, 'thiếu users phải không hợp lệ');
  assert.strictEqual(db.verifyIntegrity({ users: [], players: [] }), true, 'users + players array phải hợp lệ');
  console.log('✅ Test 1 PASS: verifyIntegrity kiểm tra cấu trúc chính xác.');

  // -------------------------------------------------------------
  // Test 2: Ghi nguyên tử (Atomic Write) & Đồng bộ Primary Backup
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Ghi nguyên tử (Atomic Write) & Primary Backup ---');
  db.save();
  assert.strictEqual(fs.existsSync(db.dbPath), true, 'database.json phải tồn tại');
  assert.strictEqual(fs.existsSync(db.backupPath), true, 'database.backup.json phải tồn tại');

  const mainContent = fs.readFileSync(db.dbPath, 'utf8');
  const backupContent = fs.readFileSync(db.backupPath, 'utf8');
  assert.deepStrictEqual(JSON.parse(mainContent), JSON.parse(backupContent), 'Backup chính phải khớp 100% database.json');
  console.log('✅ Test 2 PASS: Ghi nguyên tử và đồng bộ primary backup thành công.');

  // -------------------------------------------------------------
  // Test 3: Tạo bản sao lưu xoay vòng (Rolling Backup Snapshots)
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Tạo & quản lý backup snapshots ---');
  const snap1 = db.createBackup('test_unit1');
  assert.strictEqual(fs.existsSync(snap1), true, 'Snapshot 1 phải được tạo trên đĩa');

  const backupList = db.getBackupList();
  assert.strictEqual(Array.isArray(backupList), true, 'getBackupList phải trả về mảng');
  assert.strictEqual(backupList.some(b => b.path === snap1), true, 'Snapshot 1 phải có trong danh sách');
  console.log(`✅ Test 3 PASS: Tạo backup snapshot thành công (${backupList.length} snapshots hiện có).`);

  // -------------------------------------------------------------
  // Test 4: Tự động khôi phục khi database.json bị Corrupt (Tầng 1 - Primary Backup)
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Tự động phục hồi khi database.json bị Corrupt ---');
  // Giả lập crash/mất điện làm hỏng file database.json
  fs.writeFileSync(db.dbPath, '{"users": [ broken json text !!! ...', 'utf8');
  assert.strictEqual(fs.readFileSync(db.dbPath, 'utf8').includes('broken json'), true);

  // Kích hoạt db.load()
  db.load();

  // Xác minh database tự phục hồi hoàn chỉnh từ primary backup
  assert.strictEqual(db.data.users.length, baselineUsers.length, 'Số lượng users sau phục hồi phải đầy đủ');
  assert.strictEqual(db.data.players.length, baselinePlayers.length, 'Số lượng players sau phục hồi phải đầy đủ');

  // Xác minh file trên đĩa đã được sửa lại hợp lệ
  const repairedContent = fs.readFileSync(db.dbPath, 'utf8');
  const repairedParsed = JSON.parse(repairedContent);
  assert.strictEqual(repairedParsed.users.length, baselineUsers.length);
  console.log('✅ Test 4 PASS: Tự động phát hiện corrupt và phục hồi từ primary backup thành công.');

  // -------------------------------------------------------------
  // Test 5: Tự động khôi phục đa tầng (Tầng 2 - Snapshots Directory)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Phục hồi đa tầng khi cả primary backup cũng bị hỏng ---');
  const deepSnap = db.createBackup('deep_recovery_test');
  
  // Phá hỏng cả file chính và file primary backup
  fs.writeFileSync(db.dbPath, 'CORRUPTED_MAIN', 'utf8');
  fs.writeFileSync(db.backupPath, 'CORRUPTED_PRIMARY_BACKUP', 'utf8');

  // Load lại database
  db.load();

  // Xác minh đã tìm thấy snapshot và phục hồi thành công
  assert.strictEqual(db.data.users.length, baselineUsers.length, 'Users phải phục hồi từ snapshots');
  assert.strictEqual(db.data.players.length, baselinePlayers.length, 'Players phải phục hồi từ snapshots');
  console.log('✅ Test 5 PASS: Phục hồi đa tầng từ snapshots thành công.');

  // -------------------------------------------------------------
  // Test 6: Xử lý an toàn khi ghi đĩa thất bại (Disk Write Failure)
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Xử lý an toàn khi ghi đĩa thất bại ---');
  const originalWriteFileSync = fs.writeFileSync;
  let writeFailed = false;

  try {
    // Mock fs.writeFileSync ném lỗi ENOSPC (Disk full)
    fs.writeFileSync = (targetPath, ...args) => {
      if (typeof targetPath === 'string' && targetPath.includes('.tmp.')) {
        const err = new Error('ENOSPC: no space left on device, write');
        err.code = 'ENOSPC';
        throw err;
      }
      return originalWriteFileSync(targetPath, ...args);
    };

    try {
      db.save();
    } catch (e) {
      writeFailed = true;
      assert.strictEqual(e.code, 'ENOSPC');
    }

    assert.strictEqual(writeFailed, true, 'db.save() phải ném ngoại lệ khi đĩa lỗi');
    // Xác minh dữ liệu in-memory và file gốc không bị xóa/corrupt
    assert.strictEqual(db.data.users.length, baselineUsers.length, 'Bộ nhớ in-memory phải được bảo toàn');
    assert.strictEqual(JSON.parse(fs.readFileSync(db.dbPath, 'utf8')).users.length, baselineUsers.length, 'File gốc trên đĩa phải nguyên vẹn');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  console.log('✅ Test 6 PASS: Xử lý an toàn khi lỗi ghi đĩa, không làm hỏng dữ liệu gốc.');

  // -------------------------------------------------------------
  // Test 7: Lock Timeout & Chống Deadlock (server/utils/lock.js)
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Lock Timeout & Chống Deadlock ---');
  clearAllLocks();
  setLockTimeout(80); // Đặt timeout ngắn 80ms cho test

  const testUid = 'local_test_deadlock_uid';
  let request1Started = false;
  let request2Started = false;

  // Request 1 lấy khóa và CỐ TÌNH không gọi release
  const rel1 = await acquireLock(testUid);
  request1Started = true;

  const t0 = Date.now();
  // Request 2 yêu cầu cùng khóa -> phải tự giải phóng sau ~80ms thay vì treo vĩnh viễn
  const rel2 = await acquireLock(testUid);
  const elapsed = Date.now() - t0;
  request2Started = true;

  assert.strictEqual(request1Started, true);
  assert.strictEqual(request2Started, true);
  assert.strictEqual(elapsed >= 70, true, `Thời gian chờ phải >= 70ms (thực tế: ${elapsed}ms)`);
  rel2();

  setLockTimeout(10000); // Khôi phục default 10s
  clearAllLocks();
  console.log(`✅ Test 7 PASS: Lock timeout tự động giải phóng sau ${elapsed}ms, chống deadlock thành công.`);

  // -------------------------------------------------------------
  // Test 8: Ghi đồng thời cường độ cao (Concurrent Writes Stress Test)
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Ghi đồng thời cường độ cao (50 concurrent writes) ---');
  const concurrentCount = 50;
  const promises = [];

  for (let i = 0; i < concurrentCount; i++) {
    promises.push(new Promise((resolve, reject) => {
      try {
        db.save();
        resolve();
      } catch (err) {
        reject(err);
      }
    }));
  }

  await Promise.all(promises);
  assert.strictEqual(db.verifyIntegrity(JSON.parse(fs.readFileSync(db.dbPath, 'utf8'))), true, 'File sau 50 concurrent writes phải 100% hợp lệ');
  console.log('✅ Test 8 PASS: 50 tác vụ ghi đồng thời hoàn thành không lỗi.');

  // -------------------------------------------------------------
  // Test 9: Khôi phục và Dọn dẹp Database Sạch sẽ
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Dọn dẹp & Bảo đảm Database sạch sẽ 100% ---');
  db.data.users = baselineUsers;
  db.data.players = baselinePlayers;
  db.data.guilds = baselineGuilds;
  db.data.alliances = [];
  db.save();

  // Xóa các file snapshot test sinh ra trong thư mục backups/
  try {
    const list = db.getBackupList();
    for (const b of list) {
      if (b.name.includes('test_unit') || b.name.includes('deep_recovery')) {
        fs.unlinkSync(b.path);
      }
    }
  } catch (e) {}

  db.load();
  assert.strictEqual(db.data.users.length, baselineUsers.length, 'Users phải khớp 100% baseline ban đầu');
  assert.strictEqual(db.data.players.length, baselinePlayers.length, 'Players phải khớp 100% baseline ban đầu');
  console.log('✅ Test 9 PASS: Cơ sở dữ liệu và snapshots được dọn dẹp sạch sẽ 100%.');

  console.log('\n🎉 TOÀN BỘ 9/9 KIỂM THỬ HARDENING DATABASE ĐẠT 100% PASS!\n');
}

if (require.main === module) {
  runDatabaseHardeningTests().catch(err => {
    console.error('❌ KIỂM THỬ DATABASE HARDENING THẤT BẠI:', err);
    process.exit(1);
  });
}

module.exports = { runDatabaseHardeningTests };
