const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Vercel deployment exposes the client and a WebSocket-only Socket.IO function', () => {
    const config = JSON.parse(
        fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')
    );

    assert.equal(config.functions['api/socket-io.js'].maxDuration, 300);
    assert.deepEqual(config.rewrites, [
        { source: '/', destination: '/client/index.html' },
        { source: '/:asset*', destination: '/client/:asset*' }
    ]);

    const server = require('../api/socket-io');
    assert.ok(server instanceof http.Server);
    assert.equal(server.listening, false);
    assert.ok(server.listeners('upgrade').length > 0);

    const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
    assert.match(html, /cdn\.socket\.io\/4\.6\.1\/socket\.io\.min\.js/);

    const main = fs.readFileSync(path.join(root, 'client/main.js'), 'utf8');
    assert.match(main, /path:\s*['"]\/api\/socket-io\/socket\.io['"]/);
    assert.match(main, /transports:\s*\[['"]websocket['"]\]/);
});
