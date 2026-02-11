## Sherm Map

Aktuell gebaut in JS und Node, mit Leaflet im Frontend.

Idee.
Die Map und alle Sherm APIs sind public. D.h. jeder kann die validierten Sherms einsehen und abrufen. 
Jeder kann einen Sherm einragen, d.h. ein Titel,Beschriebung,Bild und Koordinaten hochladen. 
Diese Sherms sind standartmaessig NICHT in der Map zu sehen und gelten als unvalidiert. Erst wenn ein Admin, sich im Admin Panel anmeldet und den jeweiligen Sherm (und das Bild) validiert, d.h. nach illegalen oder Datenschutzschwierigen Daten durchschaut hat.


### Probleme /  To Do
- Auch die unvalidierten Sherms und deren Bilder sind in der API abrufbar. 

### Backend
Node JS Server.


### Postgres Datenbank und Datenbank Struktur
Das Sherm Backend kommuniziert mit einer Postgres Datenbank, die mit dem Plugin GIS (fuer geodaten) ausgestattet ist (im Docker Compose ist direkt ein Postgres Image mit Gis gewahlt).
Das Datenbank schema sieht folgendes Schema vor:

'''
CREATE TABLE IF NOT EXISTS markers (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    author TEXT,
    validated BOOLEAN DEFAULT false,
    image_path TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
); '''

Also die ID, den Sherm Titel, eine Beschreibung, einen Author, einen valitaded Bolian, den Path fuer die Bilder.

