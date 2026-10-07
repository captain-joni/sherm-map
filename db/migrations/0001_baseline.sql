-- Baseline: exakt das Schema der alten App (db/init/01_schema.sql).
-- Auf der bestehenden Prod-DB ändert diese Migration nichts, auf einer leeren DB legt sie das Ausgangsschema an.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

CREATE TABLE IF NOT EXISTS markers (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    author TEXT,
    validated BOOLEAN DEFAULT false,
    image_path TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW()
);
