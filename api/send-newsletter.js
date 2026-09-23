const https = require('https');
const { neonQuery } = require('./db');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

    const adminKey = process.env.ADMIN_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    const authHeader = req.headers.authorization;
    if (!adminKey || !authHeader || authHeader !== `Bearer ${adminKey}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    if (!resendKey) {
        return res.status(503).json({ error: 'RESEND_API_KEY non configuré.' });
    }

    if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const { subject, html, testEmail } = req.body || {};
    if (!subject || !html) {
        return res.status(400).json({ error: 'Sujet et contenu requis.' });
    }

    try {
        let recipients = [];

        if (testEmail) {
            recipients = [testEmail];
        } else {
            const subs = await neonQuery("SELECT email FROM subscribers WHERE active = TRUE");
            recipients = (subs.rows || []).map(s => s.email);
        }

        if (recipients.length === 0) {
            return res.status(400).json({ error: 'Aucun abonné actif.' });
        }

        const result = await resendSend({
            from: 'Team Group <onboarding@resend.dev>',
            to: recipients,
            subject,
            html
        }, resendKey);

        if (result.id) {
            return res.status(200).json({
                success: true,
                message: `Email envoyé à ${recipients.length} destinataire(s).`,
                id: result.id
            });
        } else {
            return res.status(500).json({
                error: result.message || 'Erreur lors de l\'envoi.'
            });
        }
    } catch (err) {
        console.error('Send newsletter error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
    }
};

function resendSend(data, apiKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const options = {
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(d);
                    if (res.statusCode >= 400) {
                        resolve({ message: parsed.message || `Erreur ${res.statusCode}` });
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    resolve({ message: 'Réponse invalide du serveur.' });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
