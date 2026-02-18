import { splitCoordinates } from './js/utils.js'

document.getElementById('add-marker-btn').addEventListener('click', async () => {
  const title = document.getElementById('marker-title').value;
  const description = document.getElementById('marker-description').value;
  const imageFile = document.getElementById('marker-image').files[0];
  const coord = document.getElementById('marker-coord').value;
  let lat;
  let lng;
  try{
    [lat, lng] = splitCoordinates(coord);
    } catch(err){
    alert('Koordinatenformat stimmt nicht!');
    return;
  }

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
    const res = await fetch('/api/public/markers', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('marker-result').innerText = 'Marker erfolgreich erstellt! Er muss nur noch von uns geprueft werden.';
      document.getElementById('marker-title').value = '';
      document.getElementById('marker-description').value = '';
      document.getElementById('marker-coord').value = '';
      document.getElementById('marker-image').value = '';
    } else {
      document.getElementById('marker-result').innerText = 'Fehler beim Speichern!';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('marker-result').innerText = 'Serverfehler!';
  }
});

[document.getElementById('marker-title'),
  document.getElementById('marker-description'),
  document.getElementById('marker-coord')]
  .forEach(element => {
  element.addEventListener("keydown", (event) => {
  if(!(event.key === "Enter")) // keine ahnung ob man hier noch filtern sollte, ob alles ausgefüllt ist, prob net
  {return};
  document.getElementById('add-marker-btn').click()
})
});
