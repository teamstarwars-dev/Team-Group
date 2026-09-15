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
            const { action, email, subscriber_id } = req.query || {};

            if (action === 'events' && subscriber_id) {
                const events = await pgQuery(
                    `SELECT * FROM subscriber_events WHERE subscriber_id = ${subscriber_id} ORDER BY created_at DESC LIMIT 100`,
                    apiUrl, apiToken
                );
                return res.status(200).json({ events: events.rows || [] });
            }

            if (action === 'stats') {
                const total = await pgQuery('SELECT COUNT(*) as total FROM subscribers', apiUrl, apiToken);
                const active = await pgQuery('SELECT COUNT(*) as active FROM subscribers WHERE active = TRUE', apiUrl, apiToken);
                const today = await pgQuery(
                    "SELECT COUNT(*) as today FROM subscribers WHERE subscribed_at >= CURRENT_DATE",
                    apiUrl, apiToken
                );
                const thisWeek = await pgQuery(
                    "SELECT COUNT(*) as week FROM subscribers WHERE subscribed_at >= CURRENT_DATE - INTERVAL '7 days'",
                    apiUrl, apiToken
                );
                return res.status(200).json({
                    total: total.rows[0]?.total || 0,
                    active: active.rows[0]?.active || 0,
                    today: today.rows[0]?.today || 0,
                    thisWeek: thisWeek.rows[0]?.week || 0
                });
            }

            const rows = await pgQuery(
                "SELECT * FROM subscribers WHERE active = TRUE ORDER BY subscribed_at DESC",
                apiUrl, apiToken
            );
            return res.status(200).json({ count: rows.rows.length, subscribers: rows.rows || [] });
        }

        if (req.method === 'DELETE') {
            const { email, reason } = req.query || {};
            if (!email) return res.status(400).json({ error: 'Email requis.' });

            const sub = await pgQuery(
                `SELECT id FROM subscribers WHERE email = '${esc(email.toLowerCase())}'`,
                apiUrl, apiToken
            );

            const now = new Date().toISOString();
            await pgQuery(
                `UPDATE subscribers SET active = FALSE, unsubscribed_at = '${now}',
                 unsubscription_reason = '${esc(reason || 'admin')}' WHERE email = '${esc(email.toLowerCase())}'`,
                apiUrl, apiToken
            );

            if (sub.rows && sub.rows[0]) {
                const ip = req.headers['x-forwarded-for'] || 'admin';
                const ua = req.headers['user-agent'] || 'admin';
                await pgQuery(
                    `INSERT INTO subscriber_events (subscriber_id, event_type, ip_address, user_agent, metadata)
                     VALUES (${sub.rows[0].id}, 'unsubscribe', '${esc(ip)}', '${esc(ua)}',
                     '{"reason": "${esc(reason || 'admin')}"}'::jsonb)`,
                    apiUrl, apiToken
                );
            }

            return res.status(200).json({ success: true, message: 'Abonné supprimé.' });
        }
    } catch (err) {
        console.error('Admin API error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
};

function esc(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "''");
}

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
