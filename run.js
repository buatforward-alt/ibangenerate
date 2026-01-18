require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// --- KONFIGURASI ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 7815361814; // ID Admin Kamu
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// Inisialisasi Bot & Server
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Paths
const USER_DB = 'users.json';
const VOUCHER_DB = 'vouchers.json';

// Init Database
if (!fs.existsSync(USER_DB)) fs.writeFileSync(USER_DB, '{}');
if (!fs.existsSync(VOUCHER_DB)) fs.writeFileSync(VOUCHER_DB, '{}');

const loadData = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Config Negara
const COUNTRY_CONFIG = {
    'GB': { name: 'United Kingdom', nat: 'gb', flag: '🇬🇧', bank: 'MIDL', code: '1611', len: 8 },
    'FR': { name: 'Perancis', nat: 'fr', flag: '🇫🇷', bank: '20041', code: '1527', len: 11 },
    'DE': { name: 'Germany', nat: 'de', flag: '🇩🇪', bank: '70051540', code: '1314', len: 10 },
    'NL': { name: 'Belanda', nat: 'nl', flag: '🇳🇱', bank: 'ABNA', code: '2321', len: 10 }
};

// ==========================================
// 1. BAGIAN WEBSITE API (SCRAPER & AUTH)
// ==========================================

// Scraper Real Identity (FakeIT)
async function scrapeFakeIT(countryCode) {
    try {
        const url = `https://fakeit.receivefreesms.co.uk/c/${countryCode.toLowerCase()}/`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        const getVal = (label) => {
            const regex = new RegExp(`>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>(.*?)<\\/td>`, 'i');
            const match = data.match(regex);
            return match ? match[1].replace(/<[^>]*>/g, '').replace(/Loading\.\.\./gi, '').trim() : null;
        };

        const res = { name: getVal('Name'), address: getVal('Address'), city: getVal('City'), zip: getVal('Postcode'), phone: getVal('Phone'), iban: getVal('IBAN') };
        return res.name ? res : null;
    } catch (e) { return null; }
}

// API Generate Identity (Website)
app.get('/api/generate-identity/:cc', async (req, res) => {
    const data = await scrapeFakeIT(req.params.cc);
    if (data) res.json({ success: true, source: 'real-scraper', data });
    else res.json({ success: false, message: "Scraper Failed" });
});

// API Login
app.post('/api/login', (req, res) => {
    const { teleId, password } = req.body;
    if (teleId == ADMIN_ID && password === ADMIN_PASS) return res.json({ success: true, userId: teleId });
    const users = loadData(USER_DB);
    if (users[teleId] && users[teleId].password === password) return res.json({ success: true, userId: teleId });
    res.json({ success: false, message: "Login Gagal" });
});

// API Request OTP
const OTP_CACHE = {};
app.post('/api/request-otp', async (req, res) => {
    const { teleId } = req.body;
    if (!teleId) return res.json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    OTP_CACHE[teleId] = otp;
    bot.sendMessage(teleId, `🔐 *OTP LOGIN WEB:* \`${otp}\``, { parse_mode: 'Markdown' }).catch(() => {});
    res.json({ success: true });
});

// API Verify OTP
app.post('/api/verify-otp', (req, res) => {
    const { teleId, otp, password } = req.body;
    if (OTP_CACHE[teleId] && OTP_CACHE[teleId] === otp) {
        const users = loadData(USER_DB);
        users[teleId] = { password, isPremium: false, expiry: 0, joined: Date.now() };
        saveData(USER_DB, users);
        delete OTP_CACHE[teleId];
        
        bot.sendMessage(ADMIN_ID, `👤 *NEW WEB USER:* \`${teleId}\``, { parse_mode: 'Markdown' });
        res.json({ success: true, userId: teleId });
    } else {
        res.json({ success: false, message: "OTP Salah" });
    }
});

// API Get User Info
app.get('/api/user/:id', async (req, res) => {
    const id = req.params.id;
    const users = loadData(USER_DB);
    let role = 'GUEST', isPremium = false, expiry = 0, username = 'User', photo = '';

    if (id == ADMIN_ID) { role = 'ADMIN'; isPremium = true; expiry = 4102444800000; }
    else if (users[id]) { role = 'MEMBER'; isPremium = users[id].isPremium; expiry = users[id].expiry; }

    // Sync Foto & Username dari Telegram
    try {
        const chat = await bot.getChat(id);
        username = chat.username ? `@${chat.username}` : chat.first_name;
        const photos = await bot.getUserProfilePhotos(id, { limit: 1 });
        if (photos.total_count > 0) {
            // Kita kirim file_id ke frontend tidak aman, idealnya download dulu
            // Untuk simplifikasi, kita pakai placeholder atau logic download (opsional)
            // Di sini kita return username dulu
        }
    } catch (e) {}

    res.json({ role, isPremium, expiry, username, photo: 'https://cdn-icons-png.flaticon.com/512/149/149071.png' });
});

// API Claim Voucher (Website)
app.post('/api/claim', (req, res) => {
    const { userId, code } = req.body;
    const vocs = loadData(VOUCHER_DB);
    const users = loadData(USER_DB);

    if (vocs[code] && vocs[code].status === 'available') {
        vocs[code].status = 'used'; vocs[code].usedBy = userId;
        users[userId] = users[userId] || { isPremium: false, expiry: 0 };
        users[userId].isPremium = true;
        users[userId].expiry = Date.now() + (vocs[code].duration * 86400000);
        
        saveData(VOUCHER_DB, vocs);
        saveData(USER_DB, users);
        
        bot.sendMessage(ADMIN_ID, `💰 *WEB CLAIM:* \`${code}\` by \`${userId}\``, { parse_mode: 'Markdown' });
        return res.json({ success: true, days: vocs[code].duration });
    }
    res.json({ success: false, message: "Invalid Voucher" });
});

// API Create Voucher (Admin Web)
app.post('/api/create-voucher', (req, res) => {
    if (req.body.userId != ADMIN_ID) return res.status(403).json({});
    const vocs = loadData(VOUCHER_DB);
    for(let i=0; i<req.body.qty; i++) {
        const c = `GENPAC-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        vocs[c] = { duration: parseInt(req.body.days), status: 'available' };
    }
    saveData(VOUCHER_DB, vocs);
    res.json({ success: true });
});

// Routing Frontend
app.get('/api/vouchers', (req, res) => res.json(loadData(VOUCHER_DB)));
app.get('/api/users', (req, res) => res.json(loadData(USER_DB)));
app.post('/api/reset', (req, res) => {
    if (req.body.userId != ADMIN_ID) return res.status(403).json({});
    saveData(USER_DB, {}); saveData(VOUCHER_DB, {});
    res.json({ success: true });
});
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


// ==========================================
// 2. BAGIAN TELEGRAM BOT LOGIC
// ==========================================

const getCountryKeyboard = () => ({
    inline_keyboard: [
        [{ text: "🇩🇪 Germany", callback_data: 'G_DE' }, { text: "🇫🇷 Perancis", callback_data: 'G_FR' }],
        [{ text: "🇳🇱 Belanda", callback_data: 'G_NL' }, { text: "🇬🇧 UK", callback_data: 'G_GB' }]
    ]
});

// Bot: /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const users = loadData(USER_DB);
    
    // Auto Register
    if (!users[chatId]) users[chatId] = { isPremium: false, joined: Date.now(), total_generate: 0 };
    if (chatId == ADMIN_ID) { users[chatId].isPremium = true; users[chatId].expiry = 4102444800000; }
    saveData(USER_DB, users);

    const isPrem = users[chatId].isPremium;
    const menu = `*▌ N I N E P A C M A N . I D ▌*\n*Verified Identity Generator*\n━━━━━━━━━━━━━━━━━━━━\n` +
                 `👤 *USER:* \`${msg.from.first_name}\`\n🆔 *ID:* \`${chatId}\`\n` +
                 `🎖️ *STATUS:* ${isPrem ? '`PREMIUM ✅`' : '`FREE ❌`'}\n` +
                 `━━━━━━━━━━━━━━━━━━━━\n` +
                 (isPrem ? "Pilih wilayah database untuk generate:" : "Kirim voucher untuk akses.");

    const kb = isPrem ? getCountryKeyboard() : { inline_keyboard: [[{ text: "🎫 CLAIM VOUCHER", callback_data: 'CLAIM' }]] };
    bot.sendMessage(chatId, menu, { parse_mode: 'Markdown', reply_markup: kb });
});

// Bot: Generate Identity (Callback)
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === 'CLAIM') return bot.sendMessage(chatId, "📩 *Kirim kode vouchernya disini:*", { parse_mode: 'Markdown' });

    if (q.data.startsWith('G_')) {
        const cc = q.data.split('_')[1];
        bot.answerCallbackQuery(q.id, { text: "Generating..." });

        // Pakai Scraper FakeIT agar data valid
        let u = await scrapeFakeIT(cc); 
        
        // Fallback jika scraper gagal (pakai randomuser)
        if (!u) {
            const cfg = COUNTRY_CONFIG[cc];
            const res = await axios.get(`https://randomuser.me/api/?nat=${cfg.nat}`);
            const r = res.data.results[0];
            u = { 
                name: `${r.name.first} ${r.name.last}`, 
                address: `${r.location.street.name} ${r.location.street.number}`,
                city: r.location.city, zip: r.location.postcode, phone: r.phone,
                iban: "GENERATED-LOCAL" // Simpel fallback
            };
        }

        const msg = `✅ *DATA GENERATED*\n━━━━━━━━━━━━━━━━━━━━\n` +
                    `🌍 *NEGARA:* ${COUNTRY_CONFIG[cc].name}\n` +
                    `👤 *NAMA:* \`${u.name}\`\n` +
                    `🏠 *ALAMAT:* \`${u.address}, ${u.city}\`\n` +
                    `📮 *ZIP:* \`${u.zip}\`\n` +
                    `📞 *PHONE:* \`${u.phone}\`\n` +
                    `💳 *IBAN:* \`${u.iban}\`\n` +
                    `━━━━━━━━━━━━━━━━━━━━`;
        
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: getCountryKeyboard() });
    }
});

// Bot: Voucher Claim & Create
bot.onText(/\/addvoc (.+)/, (msg, match) => {
    if (msg.chat.id != ADMIN_ID) return;
    const [qty, days] = match[1].split('|');
    const vocs = loadData(VOUCHER_DB);
    let out = "";
    for(let i=0; i<qty; i++) {
        const c = `GENPAC-${Math.random().toString(36).substr(2,8).toUpperCase()}`;
        vocs[c] = { duration: parseInt(days), status: 'available' };
        out += `\`${c}\`\n`;
    }
    saveData(VOUCHER_DB, vocs);
    bot.sendMessage(msg.chat.id, `✅ *VOUCHER DIBUAT*\n${out}`, { parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const code = msg.text.trim().toUpperCase();
    const vocs = loadData(VOUCHER_DB);
    const users = loadData(USER_DB);

    if (code.startsWith('GENPAC-') && vocs[code] && vocs[code].status === 'available') {
        vocs[code].status = 'used'; vocs[code].usedBy = msg.chat.id;
        users[msg.chat.id].isPremium = true;
        users[msg.chat.id].expiry = Date.now() + (vocs[code].duration * 86400000);
        
        saveData(VOUCHER_DB, vocs);
        saveData(USER_DB, users);
        
        bot.sendMessage(msg.chat.id, "⭐ *SUCCESS!* Akun Premium Aktif.");
        bot.sendMessage(ADMIN_ID, `🔔 *BOT CLAIM:* \`${msg.from.first_name}\` (\`${msg.chat.id}\`)`, {parse_mode: 'Markdown'});
    }
});

// ==========================================
// START SERVER (WAJIB UNTUK RENDER)
// ==========================================
app.listen(PORT, () => console.log(`🚀 SYSTEM ONLINE: PORT ${PORT}`));
