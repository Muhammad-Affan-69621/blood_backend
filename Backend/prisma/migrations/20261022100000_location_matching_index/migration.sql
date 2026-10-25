-- Speed up PostGIS radius searches without exposing coordinates.
CREATE INDEX IF NOT EXISTS "locations_geography_gist_idx"
ON "locations" USING GIST ("geography");