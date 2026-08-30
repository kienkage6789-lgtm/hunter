const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/queries'); // Ensure DB is loaded

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url} - Body:`, req.body);
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

// Backlog P1 Endpoints (Phase B & C) - Contract HTTP 501 Not Implemented an toàn
app.use('/xhrpg_gacha.php', createUnimplementedRouter('Gacha (Vòng quay)'));
app.use('/xhrpg_orion_raid.php', createUnimplementedRouter('Orion Raid (Săn Boss Orion)'));
app.use('/xhrpg_auction.php', createUnimplementedRouter('Auction (Đấu giá)'));
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
app.listen(PORT, () => {
  console.log(`🚀 Ragnalok Private Server MVP đang chạy tại http://localhost:${PORT}`);
});
