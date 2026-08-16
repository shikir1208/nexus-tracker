const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let latestLocation = {
  device_id: 'N/A',
  lat: 0.0,
  lng: 0.0,
  event: 'NO_DATA',
  timestamp: null
};

// Force serving index.html on root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint receiving location from the smartwatch button
app.post('/api/location', (req, res) => {
  const { device_id, event, lat, lng } = req.body;
  latestLocation = {
    device_id: device_id || 'watch_01',
    event: event || 'BUTTON_PRESS',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    timestamp: new Date().toLocaleTimeString()
  };

  console.log(`[ALERT] Location received from ${latestLocation.device_id}: Lat ${lat}, Lng ${lng}`);
  
  // Broadcast location update to all connected clients immediately
  io.emit('locationUpdate', latestLocation);

  res.status(200).json({ status: 'success' });
});

// Allow clients to fetch latest if they just connected
app.get('/api/location', (req, res) => {
  res.json(latestLocation);
});

io.on('connection', (socket) => {
  console.log('A client connected');
  // Send current location to newly connected client
  socket.emit('locationUpdate', latestLocation);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});