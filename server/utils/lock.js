const playerLocks = new Map();
let currentLockTimeoutMs = 10000; // 10 giây mặc định

/**
 * Đặt thời gian timeout cho khóa (dùng cho unit test hoặc cấu hình)
 * @param {number} ms 
 */
function setLockTimeout(ms) {
  currentLockTimeoutMs = Number.isInteger(ms) && ms > 0 ? ms : 10000;
}

/**
 * Lấy số lượng khóa đang hoạt động
 * @returns {number}
 */
function getActiveLocksCount() {
  return playerLocks.size;
}

/**
 * Xóa toàn bộ khóa (hỗ trợ test cleanup / reset)
 */
function clearAllLocks() {
  playerLocks.clear();
}

/**
 * Đảm bảo đồng bộ hóa luồng xử lý cho mỗi line_uid.
 * Ngăn chặn tình trạng Race Condition khi nhiều request (như game.js tick và upgrade.js)
 * cùng đọc, sửa đổi và lưu lại trường raw_data của cùng một người chơi.
 * 
 * Bổ sung Lock Timeout để chống Deadlock vĩnh viễn nếu có request bị treo hoặc quên release.
 * 
 * @param {string} line_uid 
 * @returns {Promise<Function>} Trả về hàm release() để mở khóa sau khi xử lý xong
 */
function acquireLock(line_uid) {
  if (!line_uid) {
    return Promise.resolve(() => {});
  }

  let promise = playerLocks.get(line_uid);
  if (!promise) {
    promise = Promise.resolve();
  }

  let release;
  let isReleased = false;
  let timer = null;

  const nextPromise = new Promise((resolve) => {
    release = () => {
      if (!isReleased) {
        isReleased = true;
        if (timer) clearTimeout(timer);
        resolve();
      }
    };
  });

  playerLocks.set(line_uid, nextPromise);

  // Tự động dọn dẹp map khi giải phóng khóa
  nextPromise.then(() => {
    if (playerLocks.get(line_uid) === nextPromise) {
      playerLocks.delete(line_uid);
    }
  });

  return promise.then(() => {
    // Khi bắt đầu nắm giữ khóa, thiết lập timeout an toàn chống deadlock
    timer = setTimeout(() => {
      if (!isReleased) {
        console.warn(`[Lock Timeout] ⚠️ Cảnh báo: Khóa cho line_uid ${line_uid} vượt quá ${currentLockTimeoutMs}ms! Tự động giải phóng để chống deadlock.`);
        release();
      }
    }, currentLockTimeoutMs);

    return release;
  });
}

/**
 * Khóa hai người chơi theo thứ tự cố định (lexicographical) để tránh Deadlock.
 * @param {string} uidA
 * @param {string} uidB
 * @returns {Promise<Function>} Hàm release mở khóa cả 2
 */
async function acquireTwoLocks(uidA, uidB) {
  if (!uidA) return await acquireLock(uidB);
  if (!uidB || uidA === uidB) return await acquireLock(uidA);
  const [first, second] = uidA < uidB ? [uidA, uidB] : [uidB, uidA];
  const rel1 = await acquireLock(first);
  const rel2 = await acquireLock(second);
  return () => {
    try { rel2(); } catch (e) {}
    try { rel1(); } catch (e) {}
  };
}

module.exports = {
  acquireLock,
  acquireTwoLocks,
  setLockTimeout,
  getActiveLocksCount,
  clearAllLocks
};

