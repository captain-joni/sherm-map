const TOKEN_KEY = 'adminToken';

let token = localStorage.getItem(TOKEN_KEY);
const loginContainer = document.getElementById('login-container');
const adminContainer = document.getElementById('admin-container');
const loginError = document.getElementById('login-error');
const markerList = document.getElementById('marker-list');
const imageModal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');


function showAdmin() {
  loginContainer.style.display = 'none';
  adminContainer.style.display = 'block';
  loadMarkers();
}

function logout() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  markerList.replaceChildren();
  adminContainer.style.display = 'none';
  loginContainer.style.display = 'block';
}

// fetch mit Token; bei abgelaufenem/ungültigem Token zurück zum Login
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    loginError.innerText = 'Sitzung abgelaufen, bitte neu einloggen';
    throw new Error('Nicht eingeloggt');
  }
  return res;
}

// Kleiner Helfer: Element mit Klasse und Text bauen (textContent, kein innerHTML -> kein XSS)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}


// The Login Check - after clicking the Button, an request to the Server is send to valitade the login cretentials
async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  loginError.innerText = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      document.getElementById('password').value = '';
      showAdmin();
    } else {
      loginError.innerText = data.error || 'Login fehlgeschlagen';
    }
  } catch (err) {
    console.error(err);
    loginError.innerText = 'Serverfehler';
  }
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

document.getElementById('logout-btn').addEventListener('click', logout);


// This Function Loads all the Markers, it uses the api/admin/markers api endpoint, so it gets every Marker entry from the Database and not Just the Valitated ones
async function loadMarkers() {
  try {
    const res = await apiFetch('/api/admin/markers');
    const markers = await res.json();
    markerList.replaceChildren(...markers.map(renderMarker));
  } catch (err) {
    console.error(err);
  }
}

function renderMarker(m) {
  const li = el('li');
  if (!m.validated) li.classList.add('unvalidated');

  const header = el('div', 'marker-header');
  header.append(el('strong', null, m.title), el('span', 'marker-author', ` ${m.author || 'Unbekannt'}`));

  const meta = el('p', 'marker-meta',
    `${new Date(m.created_at).toLocaleString('de-DE')} · ${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`);

  const description = el('p', 'marker-description', m.description || '');

  // Validierungs-Toggle
  const toggle = el('label', 'toggle');
  const checkbox = el('input', 'validate-checkbox');
  checkbox.type = 'checkbox';
  checkbox.checked = m.validated;
  const toggleLabel = el('span', 'toggle-label', m.validated ? 'Validiert' : 'Unvalidiert');
  toggle.append(checkbox, el('span', 'slider'), toggleLabel);

  checkbox.addEventListener('change', async () => {
    const validated = checkbox.checked;
    try {
      const res = await apiFetch(`/api/admin/markers/${m.id}/validate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validated })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toggleLabel.textContent = validated ? 'Validiert' : 'Unvalidiert';
      li.classList.toggle('unvalidated', !validated);
    } catch (err) {
      console.error(err);
      checkbox.checked = !validated;
      alert('Speichern fehlgeschlagen');
    }
  });

  // Buttons
  const buttons = el('div', 'action-buttons');

  if (m.image_path) {
    const imgButton = el('button', 'view-image-btn', 'Bild ansehen');
    imgButton.addEventListener('click', () => showImage(m.image_path));
    buttons.append(imgButton);
  }

  // Ort auf externer Karte ansehen
  const mapLink = el('a', 'map-link-btn', 'Auf Karte zeigen');
  mapLink.href = `https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=17/${m.lat}/${m.lng}`;
  mapLink.target = '_blank';
  mapLink.rel = 'noopener noreferrer';
  buttons.append(mapLink);

  const deleteButton = el('button', 'delete-marker-btn', 'Löschen');
  deleteButton.addEventListener('click', () => deleteMarker(m.id));
  buttons.append(deleteButton);

  const actions = el('div', 'marker-actions');
  actions.append(toggle, buttons);

  li.append(header, meta, description, actions);
  return li;
}

async function deleteMarker(id) {
  if (!confirm('Bist du sicher, dass du diesen Marker löschen willst?')) return;

  try {
    const res = await apiFetch(`/api/admin/markers/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadMarkers(); // Liste neu laden
    } else {
      alert(data.error || 'Fehler beim Löschen');
    }
  } catch (err) {
    console.error(err);
    alert('Serverfehler');
  }
}

// Bilder liegen für unvalidierte Sherms nicht öffentlich, daher mit Token laden und als Blob anzeigen
async function showImage(imagePath) {
  const filename = imagePath.split('/').pop();
  try {
    const res = await apiFetch(`/api/admin/uploads/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (modalImg.src.startsWith('blob:')) URL.revokeObjectURL(modalImg.src);
    modalImg.src = URL.createObjectURL(blob);
    imageModal.style.display = 'flex';
  } catch (err) {
    console.error(err);
    alert('Bild konnte nicht geladen werden');
  }
}

// Modal schließen bei Klick
imageModal.addEventListener('click', () => {
  imageModal.style.display = 'none';
});


// Direkt beim Laden: gespeicherten Token nutzen
if (token) showAdmin();
