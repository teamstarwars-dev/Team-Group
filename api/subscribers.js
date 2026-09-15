const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const adminKey = process.env.ADMIN_KEY;
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const authHeader = req.headers.authorization;
    if (!adminKey || !authHeader || authHeader !== `Bearer ${adminKey}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    const client = await pool.connect();
    try {
        if (req.method === 'GET') {
            const { action, subscriber_id } = req.query || {};

            if (action === 'events' && subscriber_id) {
                const events = await client.query(
                    'SELECT * FROM subscriber_events WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT 100',
                    [subscriber_id]
                );
                return res.status(200).json({ events: events.rows });
            }

            if (action === 'stats') {
                const [total, active, today, thisWeek] = await Promise.all([
                    client.query('SELECT COUNT(*) as total FROM subscribers'),
                    client.query('SELECT COUNT(*) as active FROM subscribers WHERE active = TRUE'),
                    client.query("SELECT COUNT(*) as today FROM subscribers WHERE subscribed_at >= CURRENT_DATE"),
                    client.query("SELECT COUNT(*) as week FROM subscribers WHERE subscribed_at >= CURRENT_DATE - INTERVAL '7 days'")
                ]);
                return res.status(200).json({
                    total: parseInt(total.rows[0].total),
                    active: parseInt(active.rows[0].active),
                    today: parseInt(today.rows[0].today),
                    thisWeek: parseInt(thisWeek.rows[0].week)
                });
            }

            const rows = await client.query('SELECT * FROM subscribers ORDER BY subscribed_at DESC');
            return res.status(200).json({ count: rows.rows.length, subscribers: rows.rows });
        }

        if (req.method === 'DELETE') {
            const { email, reason } = req.query || {};
            if (!email) return res.status(400).json({ error: 'Email requis.' });

            const sub = await client.query('SELECT id FROM subscribers WHERE email = $1', [email.toLowerCase()]);
            await client.query(
                'UPDATE subscribers SET active = FALSE, unsubscribed_at = NOW(), unsubscription_reason = $1 WHERE email = $2',
                [reason || 'admin', email.toLowerCase()]
            );

            if (sub.rows[0]) {
                const ip = req.headers['x-forwarded-for'] || 'admin';
                const ua = req.headers['user-agent'] || 'admin';
                await client.query(
                    'INSERT INTO subscriber_events (subscriber_id, event_type, ip_address, user_agent, metadata) VALUES ($1, $2, $3, $4, $5)',
                    [sub.rows[0].id, 'unsubscribe', ip, ua, JSON.stringify({ reason: reason || 'admin' })]
                );
            }

            return res.status(200).json({ success: true, message: 'Abonné supprimé.' });
        }
    } catch (err) {
        console.error('Admin API error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
    }
};
