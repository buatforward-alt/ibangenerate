const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. Sajikan file statis dari folder 'public'
// Ini kuncinya agar index.html dan service.js bisa dibaca browser
app.use(express.static(path.join(__dirname, 'public')));

// 2. Route utama: Kirim index.html untuk halaman depan
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Jalankan Server
app.listen(PORT, () => {
    console.log(`✅ Server berjalan di port ${PORT}`);
});