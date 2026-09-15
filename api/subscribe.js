const https = require('https');

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

    const apiUrl = process.env.POSTGRES_REST_API_URL;
    const apiToken = process.env.POSTGRES_REST_API_TOKEN;
    if (!apiUrl || !apiToken) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    try {
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const referer = req.headers['referer'] || req.headers['referrer'] || 'direct';
        const normalizedEmail = email.toLowerCase().trim();
        const now = new Date().toISOString();
        const parsedUA = parseUserAgent(userAgent);

        const check = await pgQuery(
            `SELECT id, active FROM subscribers WHERE email = '${esc(normalizedEmail)}'`,
            apiUrl, apiToken
        );

        if (check.rows && check.rows.length > 0) {
            const sub = check.rows[0];
            if (sub.active) {
                return res.status(200).json({ success: true, message: 'Déjà inscrit !' });
            }
            await pgQuery(
                `UPDATE subscribers SET active = TRUE, unsubscribed_at = NULL, unsubscription_reason = NULL,
                 ip_address = '${esc(ip)}', user_agent = '${esc(userAgent)}',
                 browser = '${esc(parsedUA.browser)}', os = '${esc(parsedUA.os)}', device = '${esc(parsedUA.device)}',
                 page_visited = '${esc(pageVisited || '')}', referer = '${esc(referer)}',
                 updated_at = '${now}' WHERE email = '${esc(normalizedEmail)}'`,
                apiUrl, apiToken
            );
            await logEvent(sub.id, 'resubscribe', ip, userAgent, { pageVisited, referer }, apiUrl, apiToken);
            return res.status(200).json({ success: true, message: 'Réinscription confirmée !' });
        }

        const ins = await pgQuery(
            `INSERT INTO subscribers (email, source, ip_address, user_agent, browser, os, device, page_visited, referer, subscribed_at)
             VALUES ('${esc(normalizedEmail)}', '${esc(source || 'Team Group')}', '${esc(ip)}', '${esc(userAgent)}',
                     '${esc(parsedUA.browser)}', '${esc(parsedUA.os)}', '${esc(parsedUA.device)}',
                     '${esc(pageVisited || '')}', '${esc(referer)}', '${now}')
             RETURNING id`,
            apiUrl, apiToken
        );

        const newId = ins.rows && ins.rows[0] ? ins.rows[0].id : null;
        if (newId) {
            await logEvent(newId, 'subscribe', ip, userAgent, { pageVisited, referer }, apiUrl, apiToken);
        }

        return res.status(200).json({
            success: true,
            message: 'Inscription confirmée ! Vous recevrez nos prochaines alertes.'
        });
    } catch (err) {
        console.error('Newsletter error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
    }
};

function logEvent(subscriberId, eventType, ip, userAgent, metadata, apiUrl, apiToken) {
    const metaJson = JSON.stringify(metadata).replace(/'/g, "''");
    return pgQuery(
        `INSERT INTO subscriber_events (subscriber_id, event_type, ip_address, user_agent, metadata)
         VALUES (${subscriberId}, '${eventType}', '${esc(ip)}', '${esc(userAgent)}', '${metaJson}'::jsonb)`,
        apiUrl, apiToken
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
