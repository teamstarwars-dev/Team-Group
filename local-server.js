const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
    '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    const fp = path.join(ROOT, url);
    fs.readFile(fp, (err, data) => {
        if (err) {
            fs.readFile(path.join(ROOT, '404.html'), (e, d) => {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(d || '404');
            });
        } else {
            res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
            res.end(data);
        }
    });
}).listen(3000, () => console.log('http://localhost:3000'));
