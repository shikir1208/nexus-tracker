const MAP_THEMES = {
  light: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  },
  dark: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  }
};

const DEFAULT_CENTER = [33.3152, 44.3661];
const DEFAULT_ZOOM = 13;

let map;
let tileLayer;
let markers = new Map();
let patients = [];
let editingPatientId = null;
let socket;
let toastTimer;

const customIcon = L.divIcon({
  className: 'custom-div-icon',
  html: "<div class='marker-ring'></div><div class='marker-pin'></div>",
  iconSize: [44, 44],
  iconAnchor: [22, 22]
});

function getStored(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

function setStored(key, value) {
  localStorage.setItem(key, value);
}

function applyUiTheme(theme) {
  document.documentElement.setAttribute('data-ui-theme', theme);
  document.querySelectorAll('#ui-theme-toggle button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.uiTheme === theme);
  });
  setStored('nuhra-ui-theme', theme);
}

function applyMapTheme(theme) {
  if (!map) return;
  if (tileLayer) map.removeLayer(tileLayer);
  const config = MAP_THEMES[theme];
  tileLayer = L.tileLayer(config.url, {
    attribution: config.attribution,
    maxZoom: config.maxZoom,
    maxNativeZoom: config.maxZoom
  }).addTo(map);
  document.getElementById('map').classList.toggle('map-dark', theme === 'dark');
  tileLayer.on('tileerror', () => document.getElementById('map-notice')?.classList.add('visible'));
  document.querySelectorAll('#map-theme-toggle button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mapTheme === theme);
  });
  setStored('nuhra-map-theme', theme);
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  applyMapTheme(getStored('nuhra-map-theme', 'dark'));
}

function popupContent(location) {
  const patientName = location.patient?.name || 'Unassigned patient';
  return `<b>${patientName}</b><br>Watch: ${location.device_id}<br>Event: ${location.event}`;
}

function hasValidCoordinates(location) {
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function upsertMarker(location) {
  if (!location.timestamp || !hasValidCoordinates(location)) return;
  const pos = [location.lat, location.lng];
  let marker = markers.get(location.device_id);
  if (!marker) {
    marker = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent(location));
    markers.set(location.device_id, marker);
  } else {
    marker.setLatLng(pos);
    marker.setPopupContent(popupContent(location));
  }
}

function updateLatestPanel(location, flyToLocation = true) {
  const banner = document.getElementById('alert-banner');
  banner.textContent = location.patient
    ? `Alert from ${location.patient.name}`
    : `Alert from unassigned watch ${location.device_id}`;
  banner.classList.add('active');

  document.getElementById('val-patient').textContent = location.patient?.name || 'Not assigned';
  document.getElementById('val-device').textContent = location.device_id;
  document.getElementById('val-event').textContent = location.event;
  const validCoordinates = hasValidCoordinates(location);
  document.getElementById('val-lat').textContent = validCoordinates ? location.lat.toFixed(6) : 'GPS unavailable';
  document.getElementById('val-lng').textContent = validCoordinates ? location.lng.toFixed(6) : 'GPS unavailable';
  document.getElementById('val-time').textContent = location.timestamp;

  if (flyToLocation && validCoordinates) {
    map.flyTo([location.lat, location.lng], 16, { animate: true, duration: 1.2 });
  }
}

function handleLocations(locations, updatePanel = false) {
  locations.forEach(upsertMarker);
  if (updatePanel && locations.length > 0) {
    updateLatestPanel(locations[locations.length - 1], false);
  }
}

function setConnectionStatus(online, text) {
  const pill = document.getElementById('connection-status');
  const label = document.getElementById('connection-text');
  pill.classList.toggle('online', online);
  label.textContent = text;
}

function updateNotificationButton() {
  const button = document.getElementById('notifications-btn');
  if (!button) return;

  if (!('Notification' in window)) {
    button.hidden = true;
  } else if (Notification.permission === 'granted') {
    button.textContent = 'Alerts on';
    button.classList.add('enabled');
  } else if (Notification.permission === 'denied') {
    button.textContent = 'Alerts blocked';
    button.disabled = true;
  }
}

function showLocationToast(location) {
  const toast = document.getElementById('location-toast');
  const name = location.patient?.name || 'Patient';
  toast.innerHTML = `<strong>${escapeHtml(name)}</strong><span>Location received from ${escapeHtml(location.device_id)}</span>`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 5500);
}

function notifyPatientLocation(location) {
  if (!location.patient) return;

  showLocationToast(location);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const coordinates = hasValidCoordinates(location)
    ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
    : 'GPS position unavailable';
  new Notification(`Nuhra · ${location.patient.name}`, {
    body: `${location.event}\n${coordinates}`,
    icon: '/assets/nuhra-mark.svg',
    tag: `nuhra-location-${location.device_id}`,
    renotify: true
  });
}

function switchView(viewId) {
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === viewId);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  const titles = {
    'map-view': ['Live Map', 'Real-time watch telemetry and patient locations'],
    'patients-view': ['Patients', 'Manage watch assignments and patient records']
  };
  const [title, subtitle] = titles[viewId] || titles['map-view'];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;

  if (viewId === 'map-view') {
    setTimeout(() => map.invalidateSize(), 150);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (response.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderPatients() {
  const grid = document.getElementById('patients-grid');
  if (!patients.length) {
    grid.innerHTML = '<div class="empty-state">No patients yet. Add one and link their watch ID.</div>';
    return;
  }

  grid.innerHTML = patients.map((patient) => {
    const last = patient.lastLocation;
    const locationText = last
      ? `${last.lat.toFixed(4)}, ${last.lng.toFixed(4)} · ${last.timestamp}`
      : 'No location yet';

    return `
      <article class="patient-card">
        <div class="patient-card-head">
          <h4>${escapeHtml(patient.name)}</h4>
          <span class="watch-badge">${escapeHtml(patient.watchId)}</span>
        </div>
        <div class="patient-meta">
          <div><span>Age</span><span>${patient.age ?? '—'}</span></div>
          <div><span>Gender</span><span>${escapeHtml(patient.gender || '—')}</span></div>
          <div><span>Condition</span><span>${escapeHtml(patient.disease || '—')}</span></div>
          <div><span>Allergies</span><span>${escapeHtml(patient.allergies || 'None recorded')}</span></div>
          <div><span>Last location</span><span>${locationText}</span></div>
          <div><span>Notes</span><span>${escapeHtml(patient.notes || '—')}</span></div>
        </div>
        <div class="patient-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${patient.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-delete="${patient.id}">Delete</button>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openPatientModal(btn.dataset.edit));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deletePatient(btn.dataset.delete));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadPatients() {
  patients = await api('/api/patients');
  renderPatients();
}

function openPatientModal(patientId = null) {
  editingPatientId = patientId;
  const modal = document.getElementById('patient-modal');
  const form = document.getElementById('patient-form');
  form.reset();
  document.getElementById('patient-form-error').textContent = '';

  if (patientId) {
    const patient = patients.find((p) => p.id === patientId);
    if (!patient) return;
    document.getElementById('modal-title').textContent = 'Edit Patient';
    document.getElementById('patient-id').value = patient.id;
    document.getElementById('patient-name').value = patient.name;
    document.getElementById('patient-watch').value = patient.watchId;
    document.getElementById('patient-age').value = patient.age ?? '';
    document.getElementById('patient-gender').value = patient.gender || '';
    document.getElementById('patient-disease').value = patient.disease || '';
    document.getElementById('patient-allergies').value = patient.allergies || '';
    document.getElementById('patient-notes').value = patient.notes || '';
  } else {
    document.getElementById('modal-title').textContent = 'Add Patient';
    document.getElementById('patient-id').value = '';
  }

  modal.classList.add('open');
}

function closePatientModal() {
  document.getElementById('patient-modal').classList.remove('open');
  editingPatientId = null;
}

async function savePatient(event) {
  event.preventDefault();
  const errorEl = document.getElementById('patient-form-error');
  errorEl.textContent = '';

  const payload = {
    name: document.getElementById('patient-name').value.trim(),
    watchId: document.getElementById('patient-watch').value.trim(),
    age: document.getElementById('patient-age').value,
    gender: document.getElementById('patient-gender').value,
    disease: document.getElementById('patient-disease').value.trim(),
    allergies: document.getElementById('patient-allergies').value.trim(),
    notes: document.getElementById('patient-notes').value.trim()
  };

  try {
    if (editingPatientId) {
      await api(`/api/patients/${editingPatientId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await api('/api/patients', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    closePatientModal();
    await loadPatients();
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

async function deletePatient(patientId) {
  if (!confirm('Delete this patient record?')) return;
  await api(`/api/patients/${patientId}`, { method: 'DELETE' });
  await loadPatients();
}

function initSocket() {
  socket = io();

  socket.on('connect', () => {
    setConnectionStatus(true, 'Live connection active');
  });

  socket.on('disconnect', () => {
    setConnectionStatus(false, 'Disconnected from server');
  });

  socket.on('connect_error', () => {
    setConnectionStatus(false, 'Authentication required');
    window.location.href = '/login.html';
  });

  socket.on('locationsSnapshot', (locations) => handleLocations(locations, true));

  socket.on('locationUpdate', (location) => {
    upsertMarker(location);
    updateLatestPanel(location);
    notifyPatientLocation(location);
    loadPatients().catch(() => {});
  });
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  document.querySelectorAll('#ui-theme-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => applyUiTheme(btn.dataset.uiTheme));
  });

  document.querySelectorAll('#map-theme-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => applyMapTheme(btn.dataset.mapTheme));
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  document.getElementById('notifications-btn').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
    updateNotificationButton();
  });

  document.getElementById('add-patient-btn').addEventListener('click', () => openPatientModal());
  document.getElementById('cancel-patient-btn').addEventListener('click', closePatientModal);
  document.getElementById('patient-form').addEventListener('submit', savePatient);

  document.getElementById('patient-modal').addEventListener('click', (event) => {
    if (event.target.id === 'patient-modal') closePatientModal();
  });
}

async function boot() {
  try {
    const auth = await fetch('/api/auth/check');
    const authData = await auth.json();
    if (!authData.authenticated) {
      window.location.href = '/login.html';
      return;
    }
  } catch {
    window.location.href = '/login.html';
    return;
  }

  applyUiTheme(getStored('nuhra-ui-theme', 'dark'));
  updateNotificationButton();
  initMap();
  bindEvents();
  initSocket();
  await loadPatients();

  const existing = await api('/api/location');
  handleLocations(existing, true);
}

boot();
