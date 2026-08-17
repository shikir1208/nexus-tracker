const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const PATIENTS_FILE = path.join(DATA_DIR, 'patients.json');
const SESSION_COOKIE = 'nuhra_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CREDENTIALS = {
  username: 'Shiki',
  password: 'v,E_R6+U'
};

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const sessions = new Map();
let patients = [];
const deviceLocations = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPatients() {
  ensureDataDir();
  if (fs.existsSync(PATIENTS_FILE)) {
    try {
      patients = JSON.parse(fs.readFileSync(PATIENTS_FILE, 'utf8'));
    } catch {
      patients = [];
    }
  }
}

function savePatients() {
  ensureDataDir();
  fs.writeFileSync(PATIENTS_FILE, JSON.stringify(patients, null, 2));
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function getSessionId(req) {
  return parseCookies(req)[SESSION_COOKIE];
}

function isAuthenticated(req) {
  const sessionId = getSessionId(req);
  if (!sessionId || !sessions.has(sessionId)) return false;
  const session = sessions.get(sessionId);
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function findPatientByWatchId(watchId) {
  return patients.find((p) => p.watchId === watchId);
}

function enrichLocation(deviceId, payload) {
  const patient = findPatientByWatchId(deviceId);
  return {
    device_id: deviceId,
    event: payload.event || 'BUTTON_PRESS',
    lat: parseFloat(payload.lat),
    lng: parseFloat(payload.lng),
    timestamp: new Date().toLocaleTimeString(),
    patient: patient
      ? { id: patient.id, name: patient.name, age: patient.age }
      : null
  };
}

function getLocationsSnapshot() {
  return Object.values(deviceLocations);
}

loadPatients();

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: isAuthenticated(req), username: CREDENTIALS.username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== CREDENTIALS.username || password !== CREDENTIALS.password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, { expiresAt: Date.now() + SESSION_MAX_AGE_MS });

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  });

  res.json({ status: 'success', username: CREDENTIALS.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const sessionId = getSessionId(req);
  if (sessionId) sessions.delete(sessionId);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ status: 'success' });
});

app.get('/', (req, res) => {
  if (isAuthenticated(req)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

app.get('/login.html', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/patients', requireAuth, (req, res) => {
  const enriched = patients.map((patient) => ({
    ...patient,
    lastLocation: deviceLocations[patient.watchId] || null
  }));
  res.json(enriched);
});

app.post('/api/patients', requireAuth, (req, res) => {
  const { name, watchId, age, notes } = req.body || {};
  if (!name?.trim() || !watchId?.trim()) {
    return res.status(400).json({ error: 'Name and watch ID are required' });
  }
  if (patients.some((p) => p.watchId === watchId.trim())) {
    return res.status(409).json({ error: 'This watch ID is already assigned' });
  }

  const patient = {
    id: crypto.randomUUID(),
    name: name.trim(),
    watchId: watchId.trim(),
    age: age ? Number(age) : null,
    notes: notes?.trim() || '',
    createdAt: new Date().toISOString()
  };

  patients.push(patient);
  savePatients();
  res.status(201).json(patient);
});

app.put('/api/patients/:id', requireAuth, (req, res) => {
  const index = patients.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Patient not found' });

  const { name, watchId, age, notes } = req.body || {};
  if (!name?.trim() || !watchId?.trim()) {
    return res.status(400).json({ error: 'Name and watch ID are required' });
  }
  if (patients.some((p) => p.watchId === watchId.trim() && p.id !== req.params.id)) {
    return res.status(409).json({ error: 'This watch ID is already assigned' });
  }

  patients[index] = {
    ...patients[index],
    name: name.trim(),
    watchId: watchId.trim(),
    age: age ? Number(age) : null,
    notes: notes?.trim() || ''
  };

  savePatients();
  res.json(patients[index]);
});

app.delete('/api/patients/:id', requireAuth, (req, res) => {
  const index = patients.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Patient not found' });
  patients.splice(index, 1);
  savePatients();
  res.json({ status: 'deleted' });
});

app.post('/api/location', (req, res) => {
  const { device_id, event, lat, lng } = req.body;
  const deviceId = device_id || 'watch_01';
  const location = enrichLocation(deviceId, { event, lat, lng });
  deviceLocations[deviceId] = location;

  const label = location.patient ? location.patient.name : deviceId;
  console.log(`[ALERT] Location from ${label}: Lat ${lat}, Lng ${lng}`);

  io.emit('locationUpdate', location);
  io.emit('locationsSnapshot', getLocationsSnapshot());

  res.status(200).json({ status: 'success' });
});

app.get('/api/location', requireAuth, (req, res) => {
  res.json(getLocationsSnapshot());
});

io.use((socket, next) => {
  const cookies = parseCookies({ headers: { cookie: socket.handshake.headers.cookie } });
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId || !sessions.has(sessionId)) {
    return next(new Error('Unauthorized'));
  }
  const session = sessions.get(sessionId);
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return next(new Error('Unauthorized'));
  }
  next();
});

io.on('connection', (socket) => {
  socket.emit('locationsSnapshot', getLocationsSnapshot());

  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Nuhra running at http://localhost:${PORT}`);
});
