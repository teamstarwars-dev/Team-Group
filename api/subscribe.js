const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée.' });
    }

    const { email, source } = req.body || {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const apiKey = process.env.BUTTONDOWN_API_KEY;

    if (!apiKey) {
        return res.status(503).json({
            error: 'Service newsletter non configuré.',
            hint: 'Ajoutez BUTTONDOWN_API_KEY dans les variables d\'environnement Vercel.'
        });
    }

    try {
        const result = await buttondownSubscribe(email, source || 'Team Group', apiKey);

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: 'Inscription confirmée ! Vous recevrez nos prochaines alertes.'
            });
        } else {
            return res.status(400).json({
                error: result.message || 'Erreur lors de l\'inscription.'
            });
        }
    } catch (err) {
        console.error('Buttondown API error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
    }
};

function buttondownSubscribe(email, source, apiKey) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            email_address: email,
            type: 'subscriber',
            metadata: { source }
        });

        const options = {
            hostname: 'api.buttondown.email',
            path: '/v1/subscribers',
            method: 'POST',
            headers: {
                'Authorization': `Token ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const request = https.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => { data += chunk; });

            response.on('end', () => {
                try {
                    const parsed = JSON.parse(data);

                    if (response.statusCode === 201) {
                        resolve({ success: true });
                    } else if (response.statusCode === 409) {
                        resolve({ success: true, message: 'Déjà inscrit !' });
                    } else if (response.statusCode === 400) {
                        resolve({
                            success: false,
                            message: parsed.email_address ? 'Email invalide.' : (parsed.detail || 'Paramètres invalides.')
                        });
                    } else {
                        resolve({
                            success: false,
                            message: parsed.detail || `Erreur ${response.statusCode}`
                        });
                    }
                } catch (e) {
                    resolve({
                        success: false,
                        message: 'Réponse invalide du serveur.'
                    });
                }
            });
        });

        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}
