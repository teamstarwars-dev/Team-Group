const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { email } = req.query || req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const apiKey = process.env.HIBP_API_KEY;

    if (!apiKey) {
        return res.status(503).json({
            error: 'Service non configuré. Clé API Have I Been Pwned manquante.',
            hint: 'Ajoutez HIBP_API_KEY dans les variables d\'environnement de votre projet Vercel.',
            docs: 'https://haveibeenpwned.com/API/Key'
        });
    }

    try {
        const breaches = await checkHIBP(email, apiKey);

        if (breaches === null) {
            return res.status(200).json({
                email: email,
                found: false,
                message: 'Aucune fuite trouvée pour cette adresse email.'
            });
        }

        return res.status(200).json({
            email: email,
            found: true,
            count: breaches.length,
            breaches: breaches.map(b => ({
                name: b.Name,
                title: b.Title,
                domain: b.Domain,
                breachDate: b.BreachDate,
                dataClasses: b.DataClasses,
                pwnCount: b.PwnCount,
                description: b.Description
            }))
        });
    } catch (err) {
        console.error('HIBP API error:', err.message);

        if (err.message.includes('Trop de requêtes') || err.message.includes('429')) {
            return res.status(429).json({
                error: 'Trop de requêtes. L\'API HIBP autorise 1 requête toutes les 15 secondes.',
                retryAfter: 15
            });
        }

        if (err.message.includes('401') || err.message.includes('invalide')) {
            return res.status(401).json({
                error: 'Clé API HIBP invalide. Vérifiez votre HIBP_API_KEY.'
            });
        }

        return res.status(500).json({ error: 'Erreur lors de la vérification.' });
    }
};

function checkHIBP(email, apiKey) {
    return new Promise((resolve, reject) => {
        const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;

        const options = {
            headers: {
                'hibp-api-key': apiKey,
                'user-agent': 'TeamShield-BreachChecker'
            }
        };

        https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => { data += chunk; });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Réponse invalide de l\'API HIBP'));
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else if (res.statusCode === 401) {
                    reject(new Error('Clé API invalide (401)'));
                } else if (res.statusCode === 429) {
                    reject(new Error('Trop de requêtes (429). Réessayez dans 15 secondes.'));
                } else {
                    reject(new Error(`Erreur HTTP ${res.statusCode}`));
                }
            });
        }).on('error', (e) => {
            reject(new Error(`Erreur réseau: ${e.message}`));
        });
    });
}
