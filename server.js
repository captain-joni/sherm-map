require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const pool = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Frontend statisch ausliefern
app.use(express.static(path.join(__dirname, 'frontend')));

// Admin-Frontend ausliefern
app.use('/admin', express.static(path.join(__dirname,'frontend', 'admin')));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads') && !req.path.includes('.')) {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
  } else {
    next();
  }
});


// Public Marker-Seite ausliefern
app.use('/public', express.static(path.join(__dirname, 'frontend', 'public')));


// Routes

// GET alle validated Marker
app.get('/api/markers', async (req, res) => {
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});



// Marker löschen (nur Admin)
app.delete('/api/admin/markers/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur Admins' });

  const { id } = req.params;
  try {
    await pool.query('DELETE FROM markers WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});



// User Shit
require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;



// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Passwort prüfen
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    // JWT erzeugen
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});


const uploadPublic = multer({ storage }); // gleiche Storage wie Admin

app.post('/api/public/markers', uploadPublic.single('image'), async (req, res) => {
  const { title, lat, lng, description } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const result = await pool.query(
      `INSERT INTO markers (title, location, image_path, description, validated, author)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, FALSE, 'Public')
       RETURNING id`,
      [title, lng, lat, imagePath, description]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Insert failed' });
  }
});



// get all markers for the admin panel

app.get('/api/admin/markers', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur Admins' });

  try {
    const result = await pool.query(`
      SELECT id, title, description, author, validated,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             image_path
      FROM markers
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});


app.patch('/api/admin/markers/:id/validate', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur Admins' });

  const { id } = req.params;
  const { validated } = req.body; // true/false

  try {
    await pool.query('UPDATE markers SET validated=$1 WHERE id=$2', [validated, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});





function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user; // userId, username, role
    next();
  });
}



async function ensureAdmin() {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  const res = await pool.query('SELECT * FROM users WHERE username=$1', [adminUser]);
  if (res.rows.length === 0) {
    const hashed = await bcrypt.hash(adminPass, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      [adminUser, hashed, 'admin']
    );
    console.log('✅ Admin-Benutzer angelegt');
  } else {
    console.log('Admin existiert bereits');
  }
}

ensureAdmin();



// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
bcrypt.hash('admin123', 10).then(hash => console.log(hash));