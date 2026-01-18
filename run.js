require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // WAJIB: npm install axios
const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID; 
const ADMIN_PASS = process.env.ADMIN_PASS;
const BOT_TOKEN = process.env.BOT_TOKEN;

// URL Telegram API
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database
const FILE_USER = path.join(__dirname, 'user.json');
const FILE_VOUCHER = path.join(__dirname, 'voucher.json');
const OTP_CACHE = {}; 

// --- HELPER FUNCTIONS ---
function readJSON(file) {
    try {
        if (!fs.existsSync(file)) { fs.writeFileSync(file, '{}'); return {}; }
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return {}; }
}
function writeJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; } 
    catch { return false; }
}
async function sendTele(chatId, text) {
    try { await axios.post(`${TG_API}/sendMessage`, { chat_id: chatId, text, parse_mode: 'Markdown' }); } 
    catch (e) { console.error("Telegram Error:", e.message); }
}

// --- NEW FEATURE: IDENTITY SCRAPER ---
async function scrapeFakeIT(countryCode) {
    try {
        // Mapping kode negara ke URL target
        // DE -> /c/de/, FR -> /c/fr/, dll
        const url = `https://fakeit.receivefreesms.co.uk/c/${countryCode.toLowerCase()}/`;
        
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        // Helper regex untuk ambil value dari tabel HTML
        const getVal = (label) => {
            // Pola: <td>Label</td> <td>Value</td>
            const regex = new RegExp(`>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>(.*?)<\\/td>`, 'i');
            const match = data.match(regex);
            if (!match) return null;
            // Bersihkan tag HTML dan text 'Loading...'
            return match[1].replace(/<[^>]*>/g, '').replace(/Loading\.\.\./gi, '').trim();
        };

        const result = {
            name: getVal('Name'),
            address: getVal('Address'),
            city: getVal('City'),
            zip: getVal('Postcode'),
            phone: getVal('Phone'),
            iban: getVal('IBAN')
        };

        // Validasi: Jika gagal scrape, return null
        if (!result.name) return null;
        return result;

    } catch (e) {
        console.error("Scrape Error:", e.message);
        return null;
    }
}

// --- API ENDPOINTS ---

// 1. GENERATE IDENTITY (INTEGRASI BARU)
app.get('/api/generate-identity/:cc', async (req, res) => {
    const { cc } = req.params;
    
    // Coba ambil dari FakeIT dulu (Data Valid)
    const scrapedData = await scrapeFakeIT(cc);
    
    if (scrapedData) {
        res.json({ success: true, source: 'real-scraper', data: scrapedData });
    } else {
        // Fallback: Jika web target down, frontend akan pakai randomuser.me + IBAN generator lokal
        res.json({ success: false, message: "Scraper failed, switching to local gen" });
    }
});

// 2. AUTH SYSTEM
app.post('/api/request-otp', async (req, res) => {
    const { teleId } = req.body;
    if (!teleId) return res.json({ success: false, message: "ID Kosong" });
    if (teleId === ADMIN_ID) return res.json({ success: false, message: "Admin login pakai password!" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    OTP_CACHE[teleId] = otp;
    
    await sendTele(teleId, `🔐 *OTP NINEPACMAN*: \`${otp}\``);
    res.json({ success: true });
});

app.post('/api/verify-otp', (req, res) => {
    const { teleId, password, otp } = req.body;
    if (OTP_CACHE[teleId] && OTP_CACHE[teleId] === otp) {
        const users = readJSON(FILE_USER);
        users[teleId] = { password, isPremium: false, expiry: 0 };
        writeJSON(FILE_USER, users);
        delete OTP_CACHE[teleId];
        sendTele(ADMIN_ID, `👤 *NEW USER:* \`${teleId}\``);
        res.json({ success: true, userId: teleId });
    } else {
        res.json({ success: false, message: "OTP Salah!" });
    }
});

app.post('/api/login', (req, res) => {
    const { teleId, password } = req.body;
    if (teleId === ADMIN_ID && password === ADMIN_PASS) return res.json({ success: true, userId: teleId });
    
    const users = readJSON(FILE_USER);
    if (users[teleId] && users[teleId].password === password) return res.json({ success: true, userId: teleId });
    
    res.json({ success: false, message: "Login Gagal!" });
});

app.get('/api/user/:id', (req, res) => {
    if (req.params.id === ADMIN_ID) return res.json({ isPremium: true, expiry: 4102444800000, role: 'ADMIN' });
    const u = readJSON(FILE_USER)[req.params.id];
    res.json(u ? { isPremium: u.isPremium, expiry: u.expiry, role: 'MEMBER' } : { isPremium: false, role: 'GUEST' });
});

// 3. VOUCHER SYSTEM
app.post('/api/claim', (req, res) => {
    const { userId, code } = req.body;
    const users = readJSON(FILE_USER);
    const vouchers = readJSON(FILE_VOUCHER);
    
    if (vouchers[code] && vouchers[code].status === 'available') {
        vouchers[code].status = 'used'; vouchers[code].usedBy = userId;
        writeJSON(FILE_VOUCHER, vouchers);
        
        users[userId].isPremium = true;
        const now = Date.now();
        const base = users[userId].expiry > now ? users[userId].expiry : now;
        users[userId].expiry = base + (vouchers[code].days * 86400000);
        writeJSON(FILE_USER, users);
        
        sendTele(ADMIN_ID, `💰 *CLAIMED:* \`${code}\` by \`${userId}\``);
        return res.json({ success: true, days: vouchers[code].days });
    }
    res.json({ success: false, message: "Voucher Invalid!" });
});

// 4. ADMIN TOOLS
app.post('/api/create-voucher', (req, res) => {
    if (req.body.userId !== ADMIN_ID) return res.status(403).json({});
    const vouchers = readJSON(FILE_VOUCHER);
    for(let i=0; i<req.body.qty; i++) {
        const c = `GENPAC-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        vouchers[c] = { days: parseInt(req.body.days), status: 'available' };
    }
    writeJSON(FILE_VOUCHER, vouchers);
    res.json({ success: true });
});

app.get('/api/vouchers', (req, res) => res.json(readJSON(FILE_VOUCHER)));
app.get('/api/users', (req, res) => res.json(readJSON(FILE_USER)));
app.post('/api/reset', (req, res) => {
    if (req.body.userId !== ADMIN_ID) return res.status(403).json({});
    writeJSON(FILE_USER, {}); writeJSON(FILE_VOUCHER, {});
    res.json({ success: true });
});

// Routing Frontend
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Server Ready: ${PORT}`));
