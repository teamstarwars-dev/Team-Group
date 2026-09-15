const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    const adminKey = process.env.ADMIN_KEY;

    if (!kvUrl || !kvToken) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const authHeader = req.headers.authorization;
    if (!adminKey || !authHeader || authHeader !== `Bearer ${adminKey}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    try {
        if (req.method === 'GET') {
            const listRaw = await kvGet('newsletter:list', kvUrl, kvToken);
            const emails = listRaw ? JSON.parse(listRaw) : [];

            const subscribers = [];
            for (const email of emails) {
                const data = await kvGet(`newsletter:${email}`, kvUrl, kvToken);
                if (data) subscribers.push(JSON.parse(data));
            }

            return res.status(200).json({
                count: subscribers.length,
                subscribers: subscribers.sort((a, b) => new Date(b.date) - new Date(a.date))
            });
        }

        if (req.method === 'DELETE') {
            const { email } = req.query || {};
            if (!email) return res.status(400).json({ error: 'Email requis.' });

            await kvDel(`newsletter:${email.toLowerCase()}`, kvUrl, kvToken);

            const listRaw = await kvGet('newsletter:list', kvUrl, kvToken);
            const list = listRaw ? JSON.parse(listRaw) : [];
            const filtered = list.filter(e => e !== email.toLowerCase());
            await kvSet('newsletter:list', JSON.stringify(filtered), kvUrl, kvToken);

            return res.status(200).json({ success: true, message: 'Abonné supprimé.' });
        }
    } catch (err) {
        console.error('Admin API error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
};

function kvGet(key, url, token) {
    return new Promise((resolve, reject) => {
        https.get(`${url}/get/${encodeURIComponent(key)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data).result || null); } catch { resolve(null); }
            });
        }).on('error', reject);
    });
}

function kvSet(key, value, url, token) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ value });
        const options = {
            hostname: new URL(url).hostname,
            path: `/set/${encodeURIComponent(key)}`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const request = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

function kvDel(key, url, token) {
    return new Promise((resolve, reject) => {
        https.get(`${url}/del/${encodeURIComponent(key)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}
