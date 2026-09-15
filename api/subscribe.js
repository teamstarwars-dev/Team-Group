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

    const apiUrl = process.env.POSTGRES_REST_API_URL;
    const apiToken = process.env.POSTGRES_REST_API_TOKEN;
    if (!apiUrl || !apiToken) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();

        const check = await pgQuery(
            `SELECT id FROM subscribers WHERE email = '${normalizedEmail}'`,
            apiUrl, apiToken
        );
        if (check.rows && check.rows.length > 0) {
            return res.status(200).json({ success: true, message: 'Déjà inscrit !' });
        }

        await pgQuery(
            `INSERT INTO subscribers (email, source) VALUES ('${normalizedEmail}', '${(source || 'Team Group').replace(/'/g, "''")}')`,
            apiUrl, apiToken
        );

        return res.status(200).json({
            success: true,
            message: 'Inscription confirmée ! Vous recevrez nos prochaines alertes.'
        });
    } catch (err) {
        console.error('Newsletter error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
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
