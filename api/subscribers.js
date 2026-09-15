const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const apiUrl = process.env.POSTGRES_REST_API_URL;
    const apiToken = process.env.POSTGRES_REST_API_TOKEN;
    const adminKey = process.env.ADMIN_KEY;

    if (!apiUrl || !apiToken) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const authHeader = req.headers.authorization;
    if (!adminKey || !authHeader || authHeader !== `Bearer ${adminKey}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    try {
        if (req.method === 'GET') {
            const result = await pgQuery(
                'SELECT * FROM subscribers WHERE active = TRUE ORDER BY subscribed_at DESC',
                apiUrl, apiToken
            );
            return res.status(200).json({ count: result.rows.length, subscribers: result.rows });
        }

        if (req.method === 'DELETE') {
            const { email } = req.query || {};
            if (!email) return res.status(400).json({ error: 'Email requis.' });

            await pgQuery(
                `UPDATE subscribers SET active = FALSE WHERE email = '${email.toLowerCase().replace(/'/g, "''")}'`,
                apiUrl, apiToken
            );
            return res.status(200).json({ success: true, message: 'Abonné supprimé.' });
        }
    } catch (err) {
        console.error('Admin API error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
};

function pgQuery(query, apiUrl, apiToken) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ query });
        const url = new URL(apiUrl);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const request = https.request(options, (response) => {
            let data = '';
            response.on('data', c => data += c);
            response.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ rows: [] }); }
            });
        });
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}
