// Minimal JSON-backed API for hosted tables.
// Endpoints:
//   GET  /api/tables              -> list tables
//   POST /api/tables (JSON body)  -> add a table
//
// Stores data in tables.json next to this file. No external deps.

const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'tables.json');
const PORT = process.env.PORT || 4100;

function readTables() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeTables(tables) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tables, null, 2));
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});

  if (req.url === '/api/tables' && req.method === 'GET') {
    return json(res, 200, readTables());
  }

  if (req.url === '/api/tables' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body || '{}');
        if (!incoming.game) throw new Error('game required');
        if (!incoming.date || !incoming.time) throw new Error('date and time required');
        const tables = readTables();
        const record = {
          id: incoming.id || Date.now().toString(),
          game: incoming.game,
          host: incoming.host || 'Host',
          city: incoming.city || '',
          date: incoming.date,
          time: incoming.time,
          seats: incoming.seats || 0,
          duration: incoming.duration || 0,
          notes: incoming.notes || '',
        };
        tables.push(record);
        writeTables(tables);
        json(res, 200, record);
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Table hosting backend running at http://localhost:${PORT}`);
});
