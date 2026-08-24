# Offline world city catalog

`world-cities.v1.json.gz` is a generated runtime asset. Production requests do
not access GitHub, GeoNames, or another geocoding service.

Regenerate it intentionally from the backend directory:

```bash
npm run data:build-locations
```

The generator pins the `joelacus/world-cities` Git commit, enriches matching
rows with GeoNames IDs, IANA time zones, population and compact localized
aliases, and writes source SHA-256 values into the artifact metadata. Review
the count, checksums, representative searches, and license notice before
committing an updated artifact.

See the repository-level `THIRD_PARTY_NOTICES.md` for attribution.
