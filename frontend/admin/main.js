let token = null;
const loginContainer = document.getElementById('login-container');
const adminContainer = document.getElementById('admin-container');
const loginError = document.getElementById('login-error');


// The Login Check - after clicking the Button, an request to the Server is send to valitade the login cretentials
document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      token = data.token;
      loginContainer.style.display = 'none';
      adminContainer.style.display = 'block';
      loadMarkers();
    } else {
      loginError.innerText = data.error || 'Login fehlgeschlagen';
    }
  } catch (err) {
    console.error(err);
    loginError.innerText = 'Serverfehler';
  }
});


// The Logout Button, This logs out, and sets the JWES to Null
document.getElementById('logout-btn').addEventListener('click', () => {
  token = null;
  adminContainer.style.display = 'none';
  loginContainer.style.display = 'block';
});


// This Function Loads all the Markers, it uses the api/admin/markesr api endpoint, so it gets every Marker entry from the Database and not Just the Valitated ones
async function loadMarkers() {
  const res = await fetch('/api/admin/markers', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const markers = await res.json();
  const list = document.getElementById('marker-list');
  list.innerHTML = '';

 markers
  .sort((a, b) => a.validated - b.validated)
  .forEach(m => {
  const li = document.createElement('li');
  if (!m.validated) {
  li.classList.add('unvalidated');
}


const imgButton = m.image_path
  ? `<button class="view-image-btn" data-src="${m.image_path}">Bild ansehen</button>`
  : '';

li.innerHTML = `
  <div class="marker-header">
    <strong>${m.title}</strong>
    <span class="marker-author">${m.author || 'Unbekannt'}</span>
  </div>

  <p class="marker-description">${m.description || ''}</p>

  <div class="marker-actions">
    <label class="toggle">
      <input
        type="checkbox"
        class="validate-checkbox"
        data-id="${m.id}"
        ${m.validated ? 'checked' : ''}
      />
      <span class="slider"></span>
      <span class="toggle-label">
        ${m.validated ? 'Validiert' : 'Unvalidiert'}
      </span>
    </label>

    <div class="action-buttons">
      ${imgButton}
      <button class="delete-marker-btn">Löschen</button>
    </div>
  </div>
`;


  list.appendChild(li);
});

// Checkbox Event
document.querySelectorAll('.validate-checkbox').forEach(cb => {
  cb.addEventListener('change', async (e) => {
    const id = e.target.dataset.id;
    const validated = e.target.checked;
    await fetch(`/api/admin/markers/${id}/validate`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ validated })
    });
  });
});

// Bild-Button Event
document.querySelectorAll('.view-image-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const src = e.target.dataset.src;
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    modalImg.src = src;
    modal.style.display = 'flex';
  });
});

// Löschen-Button Event
document.querySelectorAll('.delete-marker-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    const confirmDelete = confirm('Bist du sicher, dass du diesen Marker löschen willst?');
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/admin/markers/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        loadMarkers(); // Liste neu laden
      } else {
        alert('Fehler beim Löschen');
      }
    } catch (err) {
      console.error(err);
      alert('Serverfehler');
    }
  });
});
};










// Modal schließen bei Klick
document.getElementById('image-modal').addEventListener('click', () => {
  document.getElementById('image-modal').style.display = 'none';
});



// Login
if (data.token) {
  token = data.token;
  localStorage.setItem('adminToken', token);  // ← speichern
  loginContainer.style.display = 'none';
  adminContainer.style.display = 'block';
  loadMarkers();
}

// Direkt beim Laden prüfen
window.addEventListener('DOMContentLoaded', () => {
  const savedToken = localStorage.getItem('adminToken');
  if (savedToken) {
    token = savedToken;
    loginContainer.style.display = 'none';
    adminContainer.style.display = 'block';
    loadMarkers();
  }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('adminToken');  // Token löschen
  adminContainer.style.display = 'none';
  loginContainer.style.display = 'block';
});





