const https = require('https');

function neonQuery(sql, params) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.NEON_API_KEY;
        if (!apiKey) return reject(new Error('NEON_API_KEY not set'));

        const body = JSON.stringify({ query: sql, params: params || [] });

        const options = {
            hostname: 'console.neon.tech',
            path: '/api/v2/sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) return reject(new Error(parsed.error));
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('Invalid response: ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { neonQuery };
