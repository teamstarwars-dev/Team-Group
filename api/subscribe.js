const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

    const { email, source, pageVisited } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const client = await pool.connect();
    try {
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const referer = req.headers['referer'] || req.headers['referrer'] || 'direct';
        const normalizedEmail = email.toLowerCase().trim();
        const parsedUA = parseUserAgent(userAgent);

        const existing = await client.query('SELECT id, active FROM subscribers WHERE email = $1', [normalizedEmail]);
        if (existing.rows.length > 0 && existing.rows[0].active) {
            return res.status(200).json({ success: true, message: 'Déjà inscrit !' });
        }

        if (existing.rows.length > 0) {
            await client.query(
                `UPDATE subscribers SET active = TRUE, unsubscribed_at = NULL, unsubscription_reason = NULL,
                 ip_address = $1, user_agent = $2, browser = $3, os = $4, device = $5,
                 page_visited = $6, referer = $7, updated_at = NOW()
                 WHERE email = $8`,
                [ip, userAgent, parsedUA.browser, parsedUA.os, parsedUA.device, pageVisited || '', referer, normalizedEmail]
            );
            await logEvent(client, existing.rows[0].id, 'resubscribe', ip, userAgent, { pageVisited, referer });
            return res.status(200).json({ success: true, message: 'Réinscription confirmée !' });
        }

        const result = await client.query(
            `INSERT INTO subscribers (email, source, ip_address, user_agent, browser, os, device, page_visited, referer)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [normalizedEmail, source || 'Team Group', ip, userAgent, parsedUA.browser, parsedUA.os, parsedUA.device, pageVisited || '', referer]
        );

        if (result.rows[0]) {
            await logEvent(client, result.rows[0].id, 'subscribe', ip, userAgent, { pageVisited, referer });
        }

        return res.status(200).json({
            success: true,
            message: 'Inscription confirmée ! Vous recevrez nos prochaines alertes.'
        });
    } catch (err) {
        console.error('Newsletter error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
    } finally {
        client.release();
    }
};

function logEvent(client, subscriberId, eventType, ip, userAgent, metadata) {
    return client.query(
        'INSERT INTO subscriber_events (subscriber_id, event_type, ip_address, user_agent, metadata) VALUES ($1, $2, $3, $4, $5)',
        [subscriberId, eventType, ip, userAgent, JSON.stringify(metadata)]
    );
}

function parseUserAgent(ua) {
    let browser = 'Unknown';
    let os = 'Unknown';
    let device = 'Desktop';

    if (/mobile|android|iphone|ipad/i.test(ua)) device = 'Mobile';
    else if (/tablet|ipad/i.test(ua)) device = 'Tablet';

    if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) browser = 'Chrome';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
    else if (/edge/i.test(ua)) browser = 'Edge';
    else if (/opr|opera/i.test(ua)) browser = 'Opera';

    if (/windows/i.test(ua)) os = 'Windows';
    else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
    else if (/linux/i.test(ua)) os = 'Linux';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';

    return { browser, os, device };
}
