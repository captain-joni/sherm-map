require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');

// Konfiguration
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 0); // Anzahl Proxies davor (Traefik = 1)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const FRONTEND_DIR = path.join(__dirname, 'frontend');

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 1000;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET fehlt oder ist kürzer als 32 Zeichen. Erzeugen mit: openssl rand -hex 32');
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'", 'https://unpkg.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://unpkg.com',
        'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
      'upgrade-insecure-requests': null // HTTPS macht Traefik, lokal läuft alles über http
    }
  }
}));
app.use(express.json({ limit: '10kb' }));

// Frontend statisch ausliefern (/, /create/, /admin/)
app.use(express.static(FRONTEND_DIR));


// Hilfsfunktionen

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// Steuerzeichen raus (Postgres mag z.B. \u0000 nicht), Zeilenumbrüche bleiben
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function parseCoordinate(value, limit) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  const num = Number(value);
  return Math.abs(num) <= limit ? num : null;
}

function parseId(value) {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

function validateMarkerInput(body) {
  const title = cleanText(body.title);
  const description = cleanText(body.description);
  const lat = parseCoordinate(body.lat, 90);
  const lng = parseCoordinate(body.lng, 180);

  if (!title) return { error: 'Titel fehlt' };
  if (title.length > TITLE_MAX) return { error: `Titel darf maximal ${TITLE_MAX} Zeichen haben` };
  if (description.length > DESCRIPTION_MAX) return { error: `Beschreibung darf maximal ${DESCRIPTION_MAX} Zeichen haben` };
  if (lat === null || lng === null) return { error: 'Ungültige Koordinaten' };

  return { value: { title, description: description || null, lat, lng } };
}

// Echten Dateityp an den ersten Bytes erkennen, der Mimetype vom Client ist nur eine Behauptung
async function detectImageExtension(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    await handle.read(buf, 0, 12, 0);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    return null;
  } finally {
    await handle.close();
  }
}

async function removeUpload(imagePath) {
  if (!imagePath) return;
  try {
    await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(imagePath)));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Bild löschen fehlgeschlagen:', err);
  }
}

// Dateiname aus der URL nur akzeptieren, wenn er keine Pfadteile enthält
function safeUploadName(filename) {
  return filename && filename === path.basename(filename) && !filename.startsWith('.') ? filename : null;
}


// Multer config: zufälliger Dateiname, nur Bilder, Größenlimit
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + IMAGE_EXTENSIONS[file.mimetype])
  }),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 10, fieldSize: 16 * 1024 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_EXTENSIONS[file.mimetype]) cb(null, true);
    else cb(httpError(400, 'Nur JPEG, PNG oder WebP Bilder erlaubt'));
  }
});


// Rate Limits (pro IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche, bitte später nochmal' }
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Sherms auf einmal, bitte später nochmal' }
});


// Auth

// Vergleichs-Hash für Logins mit unbekanntem User
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user; // userId, username, role
    next();
  });
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur Admins' });
    next();
  });
}


// Routes

app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

// GET alle validated Marker (öffentlich, auch von anderen Seiten abrufbar)
app.get('/api/markers', cors(), async (req, res) => {
  const result = await pool.query(`
    SELECT
      id, title, description, author,
      ST_Y(location::geometry) AS lat,
      ST_X(location::geometry) AS lng,
      image_path
    FROM markers
    WHERE validated = TRUE
  `);
  res.json(result.rows);
});

// Bilder: öffentlich nur, wenn der zugehörige Sherm validiert ist
app.get('/uploads/:filename', async (req, res) => {
  const filename = safeUploadName(req.params.filename);
  if (!filename) return res.sendStatus(404);

  const result = await pool.query(
    'SELECT 1 FROM markers WHERE image_path = $1 AND validated = TRUE',
    [`/uploads/${filename}`]
  );
  if (result.rowCount === 0) return res.sendStatus(404);

  res.sendFile(filename, { root: UPLOAD_DIR, maxAge: '1h' });
});

// Neuen Sherm eintragen (öffentlich, landet unvalidiert in der DB)
app.post('/api/public/markers', submitLimiter, upload.single('image'), async (req, res) => {
  const { error, value } = validateMarkerInput(req.body);
  let imagePath = null;

  try {
    if (error) throw httpError(400, error);

    if (req.file) {
      const realExtension = await detectImageExtension(req.file.path);
      if (realExtension !== path.extname(req.file.filename)) {
        throw httpError(400, 'Datei ist kein gültiges Bild');
      }
      imagePath = `/uploads/${req.file.filename}`;
    }

    const result = await pool.query(
      `INSERT INTO markers (title, location, image_path, description, validated, author)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, FALSE, 'Public')
       RETURNING id`,
      [value.title, value.lng, value.lat, imagePath, value.description]
    );

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    if (req.file) await removeUpload(req.file.filename);
    throw err;
  }
});

// Login
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const fail = () => res.status(401).json({ error: 'Login fehlgeschlagen' });

  if (typeof username !== 'string' || typeof password !== 'string'
      || username.length > 100 || password.length > 200) {
    return fail();
  }

  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];

  // Auch ohne User einen Hash vergleichen, damit man an der Antwortzeit nicht erkennt, ob es den User gibt
  const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !match) return fail();

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h', algorithm: 'HS256' }
  );

  res.json({ success: true, token });
});

// get all markers for the admin panel
app.get('/api/admin/markers', requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT id, title, description, author, validated, created_at,
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng,
           image_path
    FROM markers
    ORDER BY validated, created_at DESC
  `);
  res.json(result.rows);
});

// Bilder für Admins (auch unvalidierte)
app.get('/api/admin/uploads/:filename', requireAdmin, (req, res) => {
  const filename = safeUploadName(req.params.filename);
  if (!filename) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(filename, { root: UPLOAD_DIR });
});

app.patch('/api/admin/markers/:id/validate', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const { validated } = req.body || {};
  if (id === null || typeof validated !== 'boolean') {
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  }

  const result = await pool.query('UPDATE markers SET validated = $1 WHERE id = $2', [validated, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Sherm nicht gefunden' });
  res.json({ success: true });
});

// Marker löschen (inkl. Bild)
app.delete('/api/admin/markers/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Ungültige ID' });

  const result = await pool.query('DELETE FROM markers WHERE id = $1 RETURNING image_path', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Sherm nicht gefunden' });

  await removeUpload(result.rows[0].image_path);
  res.json({ success: true });
});

// Unbekannte API-Routen
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Alles andere ohne Dateiendung -> Map
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.includes('.')) {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  } else {
    next();
  }
});

// Fehlerbehandlung: nur eigene/erwartete Fehlermeldungen an den Client geben
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `Bild ist zu groß (max. ${IMAGE_MAX_BYTES / 1024 / 1024} MB)`,
  LIMIT_FILE_COUNT: 'Nur ein Bild erlaubt',
  LIMIT_UNEXPECTED_FILE: 'Unerwartetes Dateifeld'
};

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: MULTER_MESSAGES[err.code] || 'Ungültiger Upload' });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status < 500 && err.expose ? err.message : 'Serverfehler' });
});


async function ensureAdmin() {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) {
    console.log('ADMIN_USER/ADMIN_PASS nicht gesetzt, lege keinen Admin an');
    return;
  }

  const res = await pool.query('SELECT 1 FROM users WHERE username = $1', [adminUser]);
  if (res.rows.length > 0) {
    console.log('Admin existiert bereits');
    return;
  }

  if (adminPass.length < 12) {
    throw new Error('ADMIN_PASS muss mindestens 12 Zeichen haben');
  }
  const hashed = await bcrypt.hash(adminPass, 12);
  await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
    [adminUser, hashed, 'admin']
  );
  console.log('✅ Admin-Benutzer angelegt');
}


// Server starten
ensureAdmin()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Start fehlgeschlagen:', err);
    process.exit(1);
  });
