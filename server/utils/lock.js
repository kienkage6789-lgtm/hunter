const playerLocks = new Map();

/**
 * Đảm bảo đồng bộ hóa luồng xử lý cho mỗi line_uid.
 * Ngăn chặn tình trạng Race Condition khi nhiều request (như game.js tick và upgrade.js)
 * cùng đọc, sửa đổi và lưu lại trường raw_data của cùng một người chơi.
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
  const nextPromise = new Promise((resolve) => {
    release = resolve;
  });

  playerLocks.set(line_uid, nextPromise);

  // Tự động dọn dẹp map khi giải phóng khóa
  nextPromise.then(() => {
    if (playerLocks.get(line_uid) === nextPromise) {
      playerLocks.delete(line_uid);
    }
  });

  return promise.then(() => release);
}

module.exports = { acquireLock };
