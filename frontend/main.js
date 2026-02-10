// Startposition (Heidelberg)
const START_LAT = 49.413296;const START_LNG = 8.686512;
const START_ZOOM = 8;

// Map initialisieren
const map = L.map('map').setView([START_LAT, START_LNG], START_ZOOM);

// OpenStreetMap Tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Snackbar Funktion
function showSnackbar(message) {
  const snackbar = document.getElementById('snackbar');
  snackbar.innerText = message;
  snackbar.style.visibility = 'visible';
  setTimeout(() => snackbar.style.visibility = 'hidden', 2000);
}

// Koordinaten kopieren auf Klick
map.on('click', function(e) {
  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);
  navigator.clipboard.writeText(`${lat}, ${lng}`);
  showSnackbar(`Koordinaten kopiert: ${lat}, ${lng}`);
});



const AddMarkerControl = L.Control.extend({
  options: { position: 'topright' },

  onAdd: function () {
    const button = L.DomUtil.create(
      'button',
      'add-marker-control leaflet-control'
    );

    button.type = 'button';
    button.textContent = 'Marker hinzufügen';

    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.disableScrollPropagation(button);

    button.addEventListener('click', () => {
      window.location.href = '/public';
    });

    return button;
  }
});

map.addControl(new AddMarkerControl());


// Marker von DB laden
async function loadMarkers() {
  try {
    const res = await fetch('/api/markers');
    const markers = await res.json();

    markers.forEach(m => {
      const marker = L.marker([m.lat, m.lng]).addTo(map);

      let popupContent = `<strong>${m.title || 'Marker'}</strong>`;
      if (m.image_path) {
        popupContent += `<br/><img src="${m.image_path}" style="max-width:200px;margin-top:5px;margin-right:20px" />`;
      }
      if (m.description) {
        popupContent += `<p>${m.description}</p>`;
      }

      marker.bindPopup(popupContent);
    });
  } catch (err) {
    console.error('Marker laden fehlgeschlagen', err);
  }
}

loadMarkers();
