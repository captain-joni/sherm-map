document.getElementById('add-marker-btn').addEventListener('click', async () => {
  const title = document.getElementById('marker-title').value;
  const description = document.getElementById('marker-description').value;
  const lat = document.getElementById('marker-lat').value;
  const lng = document.getElementById('marker-lng').value;
  const imageFile = document.getElementById('marker-image').files[0];

  if (!title || !lat || !lng) {
    alert('Bitte Titel und Koordinaten ausfüllen!');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', description);
  formData.append('lat', lat);
  formData.append('lng', lng);
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch('http://localhost:3000/api/public/markers', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('marker-result').innerText = 'Marker erfolgreich erstellt! Er muss vom Admin validiert werden.';
      document.getElementById('marker-title').value = '';
      document.getElementById('marker-description').value = '';
      document.getElementById('marker-lat').value = '';
      document.getElementById('marker-lng').value = '';
      document.getElementById('marker-image').value = '';
    } else {
      document.getElementById('marker-result').innerText = 'Fehler beim Speichern!';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('marker-result').innerText = 'Serverfehler!';
  }
});
