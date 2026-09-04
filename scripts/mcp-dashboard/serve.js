const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
const DASHBOARD_PATH = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', dashboard: 'running' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`HooshiX MCP Dashboard: http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
