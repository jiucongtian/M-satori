# Third-party data notices

## World Cities / GeoNames

Satori's offline birth-location catalog is derived from:

- `joelacus/world-cities`, pinned to commit `55bcdd6387eb17e3b12ef56860e42f34c30178f7`;
- GeoNames downloadable city data used by that project's generator.

Source links:

- https://github.com/joelacus/world-cities
- https://www.geonames.org/
- https://creativecommons.org/licenses/by/4.0/

The source data is provided under the Creative Commons Attribution 4.0
International license. Satori filters the global catalog by population,
reduces China to province/prefecture administrative centers, selects compact
localized aliases, and packages the result as an offline compressed artifact.
The generated artifact records its source commit and SHA-256 checksums.

No endorsement by the source projects or their contributors is implied. The
data is provided without warranty of accuracy, timeliness, or completeness.
