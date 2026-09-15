const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

    const { email, source } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;

    if (!kvUrl || !kvToken) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    try {
        const key = `newsletter:${email.toLowerCase()}`;
        const existing = await kvGet(key, kvUrl, kvToken);

        if (existing) {
            return res.status(200).json({ success: true, message: 'Déjà inscrit !' });
        }

        const subscriber = {
            email: email.toLowerCase(),
            source: source || 'Team Group',
            date: new Date().toISOString(),
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
        };

        await kvSet(key, JSON.stringify(subscriber), kvUrl, kvToken);

        const listKey = 'newsletter:list';
        const listRaw = await kvGet(listKey, kvUrl, kvToken);
        const list = listRaw ? JSON.parse(listRaw) : [];
        list.push(email.toLowerCase());
        await kvSet(listKey, JSON.stringify(list), kvUrl, kvToken);

        return res.status(200).json({ success: true, message: 'Inscription confirmée ! Vous recevrez nos prochaines alertes.' });
    } catch (err) {
        console.error('Newsletter error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
    }
};

function kvGet(key, url, token) {
    return new Promise((resolve, reject) => {
        const encodedKey = encodeURIComponent(key);
        https.get(`${url}/get/${encodedKey}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.result || null);
                } catch { resolve(null); }
            });
        }).on('error', reject);
    });
}

function kvSet(key, value, url, token) {
    return new Promise((resolve, reject) => {
        const encodedKey = encodeURIComponent(key);
        const payload = JSON.stringify({ value });
        const options = {
            hostname: new URL(url).hostname,
            path: `/set/${encodedKey}`,
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
