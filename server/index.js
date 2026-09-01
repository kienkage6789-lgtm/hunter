const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/queries'); // Ensure DB is loaded

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Helper hàm làm sạch và ẩn thông tin nhạy cảm trước khi log ──
const SENSITIVE_KEY_EXACT = new Set([
  'password', 'passwd', 'pass', 'password_hash', 'new_password', 'old_password',
  'session_token', 'sessiontoken', 'auth_token', 'token', 'access_token', 'refresh_token',
  'api_key', 'apikey', 'admin_api_key', 'key', 'secret', 'secret_key', 'private_key',
  'payment_token', 'stripe_token', 'xsolla_token', 'coda_paycode', 'coda_token',
  'card_number', 'card_num', 'cvv', 'cvc', 'credit_card', 'cc_num',
  'raw_payload', 'payment_payload', 'payload', 'signature'
]);

function redactSensitiveData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY_EXACT.has(lowerKey) || 
        /(password|session_?token|api_?key|secret|payment_?token|auth_?token|credit_?card|card_?number)/i.test(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/([?&](?:password|session_?token|token|key|api_?key|admin_api_?key|secret)=)[^&]*/gi, '$1[REDACTED]');
}

// Gắn helper vào app để kiểm thử và tái sử dụng
app.redactSensitiveData = redactSensitiveData;
app.sanitizeUrl = sanitizeUrl;

// Middleware logging có kiểm soát: bảo vệ thông tin nhạy cảm, không mutate req.body
app.use((req, res, next) => {
  const cleanUrl = sanitizeUrl(req.url);
  const cleanBody = redactSensitiveData(req.body);
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    console.log(`[HTTP] ${req.method} ${cleanUrl} - Body:`, cleanBody);
  } else {
    console.log(`[HTTP] ${req.method} ${cleanUrl} - Body:`, cleanBody);
  }
  next();
});

// Cung cấp các file tĩnh của client (tắt cache để luôn nạp asset mới nhất)
const staticOptions = {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
};
app.use(express.static(path.join(__dirname, '..', 'client'), staticOptions));
app.use('/client', express.static(path.join(__dirname, '..', 'client'), staticOptions));
// (Một số file có thể tải từ /js, /css)
app.use('/js', express.static(path.join(__dirname, '..', 'client'), staticOptions));
app.use('/css', express.static(path.join(__dirname, '..', 'client'), staticOptions));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Routes
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const upgradeRoutes = require('./routes/upgrade');
const warpRoutes = require('./routes/warp');
const marketRoutes = require('./routes/market');
const offlineRoutes = require('./routes/offline');
const arenaRoutes = require('./routes/arena');
const leaderboardRoutes = require('./routes/leaderboard');
const vipRoutes = require('./routes/vip');
const droplogRoutes = require('./routes/droplog');
const tradeRoutes = require('./routes/trade');
const cwarRoutes = require('./routes/cwar');
const guildRoutes = require('./routes/guild');
const chatRoutes = require('./routes/chat');
const onlineCountRoutes = require('./routes/online_count');
const translateRoutes = require('./routes/translate');
const premiumRoutes = require('./routes/premium');
const adminRoutes = require('./routes/admin');
const eq2Routes = require('./routes/eq2');
const mdcRoutes = require('./routes/mdc');
const logoutRoutes = require('./routes/logout');
const phistoryRoutes = require('./routes/phistory');
const homeRoutes = require('./routes/home');
const chatUploadRoutes = require('./routes/chat_upload');
const chatImgRoutes = require('./routes/chat_img');
const pvpRoutes = require('./routes/pvp');
const raidRoutes = require('./routes/raid');
const gachaRoutes = require('./routes/gacha');
const auctionRoutes = require('./routes/auction');
const orionRaidRoutes = require('./routes/orion_raid');
const { createUnimplementedRouter } = require('./routes/unimplemented');

app.use('/api', authRoutes);
// Game gốc dùng đường dẫn php này
app.use('/xhrpg_game.php', gameRoutes);
app.use('/xhrpg_upgrade.php', upgradeRoutes);
app.use('/xhrpg_warp.php', warpRoutes);
app.use('/xhrpg_market.php', marketRoutes);
app.use('/xhrpg_offline.php', offlineRoutes);
app.use('/xhrpg_arena.php', arenaRoutes);
app.use('/xhrpg_leaderboard.php', leaderboardRoutes);
app.use('/xhrpg_vip.php', vipRoutes);
app.use('/xhrpg_droplog.php', droplogRoutes);
app.use('/xhrpg_trade.php', tradeRoutes);
app.use('/xhrpg_cwar.php', cwarRoutes);
app.use('/xhrpg_guild.php', guildRoutes);
app.use('/xhrpg_chat.php', chatRoutes);
app.use('/xhrpg_online_count.php', onlineCountRoutes);
app.use('/xhrpg_translate.php', translateRoutes);
app.use('/xhrpg_premium.php', premiumRoutes);
app.use('/xhrpg_eq2.php', eq2Routes);
app.use('/xhrpg_mdc.php', mdcRoutes);
app.use('/xhrpg_logout.php', logoutRoutes);
app.use('/xhrpg_phistory.php', phistoryRoutes);
app.use('/xhrpg_home.php', homeRoutes);
app.use('/xhrpg_chat_upload.php', chatUploadRoutes);
app.use('/xhrpg_chat_img.php', chatImgRoutes);
app.use('/xhrpg_pvp.php', pvpRoutes);
app.use('/xhrpg_raid.php', raidRoutes);
app.use('/api/admin', adminRoutes);
app.use('/xhrpg_google_auth.php', authRoutes); // fallback

// Gacha System (TASK-042)
app.use('/xhrpg_gacha.php', gachaRoutes);

// Auction System (TASK-043)
app.use('/xhrpg_auction.php', auctionRoutes);

// Orion Space Raid / Expedition System (TASK-044)
app.use('/xhrpg_orion_raid.php', orionRaidRoutes);

// Backlog P1 Endpoints (Phase B & C) - Contract HTTP 501 Not Implemented an toàn
app.use('/xhrpg_migrate.php', createUnimplementedRouter('Migrate Code (Di cư tài khoản)'));
app.use('/xhrpg_voucher.php', createUnimplementedRouter('Voucher (Đổi thẻ quà tặng)'));
app.use('/xhrpg_stripe_topup.php', createUnimplementedRouter('Stripe Topup (Cổng thanh toán Stripe)'));
app.use('/xhrpg_topup_promo.php', createUnimplementedRouter('Topup Promo (Khuyến mãi nạp tiền)'));
app.use('/xhrpg_coda_paycode.php', createUnimplementedRouter('CodaPay (Cổng thanh toán CodaPay)'));
app.use('/xhrpg_xsolla_token.php', createUnimplementedRouter('XSolla PayStation (Cổng thanh toán XSolla)'));

app.get('/', (req, res) => {
  res.redirect('/client/play.html');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Ragnalok Private Server MVP đang chạy tại http://localhost:${PORT}`);
  });
}

module.exports = app;
