-- Länder offline per PostGIS bestimmen. Die Polygone lädt `npm run load-countries -w backend`
-- (Natural Earth), solange die Tabellen leer sind bleibt country_code NULL.
CREATE TABLE countries (
  code text PRIMARY KEY,              -- ISO 3166-1 alpha-2
  name_de text NOT NULL,
  name_en text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL  -- komplette Fläche, z.B. für eine Weltkarte im Admin
);

-- Dieselben Flächen in kleine Stücke zerteilt (ST_Subdivide): Punkt-in-Polygon wird damit auch
-- für riesige Länder wie Russland schnell
CREATE TABLE country_parts (
  id serial PRIMARY KEY,
  code text NOT NULL REFERENCES countries(code) ON DELETE CASCADE,
  geom geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX country_parts_geom_idx ON country_parts USING gist (geom);

-- Land, das den Punkt enthält, sonst das nächste innerhalb von 25 km (Küste, kleine Inseln, Grenzflüsse)
CREATE FUNCTION country_for(p geography) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  result text;
BEGIN
  SELECT code INTO result FROM country_parts WHERE ST_Intersects(geom, p::geometry) LIMIT 1;
  IF result IS NULL THEN
    -- Grobfilter per Bounding Box (2° reichen für 25 km bis ca. 83° Breite), dann exakt in Metern
    SELECT code INTO result FROM country_parts
    WHERE geom && ST_Expand(p::geometry, 2)
      AND ST_DWithin(geom::geography, p, 25000)
    ORDER BY ST_Distance(geom::geography, p)
    LIMIT 1;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION markers_set_country() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.country_code := country_for(NEW.location);
  RETURN NEW;
END $$;

CREATE TRIGGER markers_country
  BEFORE INSERT OR UPDATE OF location ON markers
  FOR EACH ROW EXECUTE FUNCTION markers_set_country();

CREATE INDEX markers_country_idx ON markers (country_code);
