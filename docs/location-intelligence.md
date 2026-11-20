# Project location intelligence (milestone 8)

Each developer project can carry a **location profile** (address, area, coordinates) and a list of
**places** around it: nearby amenities, planned infrastructure and competing developments. Everything
is recorded by the developer's team, by hand or from a CSV file. Nothing is fetched from outside.

## Honesty rules

- **No provider, no lookups.** No map or places provider is configured (`maps_places` in the
  integration catalog has no adapter yet). Every screen says so. The map is a schematic drawn from
  recorded coordinates, not a street map.
- **Distances are straight-line or as recorded, never travel times.** `placeDistance` (core `geo.ts`)
  uses coordinates when both ends have them, otherwise the distance the person recorded, otherwise
  "unknown". Each distance is labelled with its basis.
- **Every record has a source.** `source_kind` is `manual_entry` or `structured_import`
  (`provider` is reserved and rejected until a provider exists). Planned infrastructure and competing
  developments must name a source reference; the database enforces it.
- **Verification is explicit and fragile.** Records start unverified. Someone with `inventory.verify`
  can mark them verified; any later edit clears it.
- **Coordinates are checked against the GCC.** Points outside the region are rejected with a hint
  that latitude and longitude may be swapped.
- **Empty means empty.** With no records, screens show an honest empty state and, for managers, the
  next action. Nothing is seeded.

## Data

| Table | Purpose |
| --- | --- |
| `app.project_locations` | One row per project: address, area, `latitude`/`longitude` (both or neither), source, verification, who/when |
| `app.project_places` | Places per project: `kind` (`amenity` / `infrastructure` / `competitor`), `category` (checked per kind), name, description, coordinates or `recorded_distance_m`, `stage`, `expected_date`, `developer_name`, source, verification, `status` (`active` / `archived`) |
| `project_shares.include_location` | The developer chose to show location to this brokerage |
| `project_publications.show_location` | The developer chose to show location on the public listing |
| `app.pub_locations`, `app.pub_places` | Security-barrier views: only published projects with `show_location`, active places only |

Row-level security: the owning organization can read and write; a partner brokerage can read only
through an active share with `include_location` (`app.shared_with_me(project, 'location')`);
anonymous visitors read only the public views.

## Permissions and audit

- View: `area_profile.view`. Add, edit, archive, import: `area_profile.manage`. Verify: `inventory.verify`.
- Audit events: `location.updated`, `location.verified`, `place.created`, `place.updated`,
  `place.verified`, `place.archived`, `place.imported`.

## Screens

- **Developer, project → Location.** Profile, who can see it, filters (type, category, distance),
  schematic map with numbered markers and a matching list, add / edit / verify / archive, CSV import.
- **Developer → Area profiles.** Every project's coverage at a glance.
- **Brokerage → Inventory.** Projects shared with the brokerage; a read-only Location view when the
  share includes it.
- **Public project page.** "Location and surroundings", when the developer turned it on.

## CSV import

Header row, then up to 200 rows. Columns: `kind, category, name, latitude, longitude, distance_km,
stage, expected_date, developer, description, source`. Rows without their own `source` use the
file-level source. Every row is validated first; if any fails, nothing is imported and the failing
lines are listed.

## Enabling a map provider later

The `maps_places` connector (milestone 11) needs an adapter and a `MAPS_API_KEY` stored as a secret.
When it exists, records it supplies will use `source_kind = 'provider'`, and map tiles can replace the
schematic. Until then, nothing here calls an outside service.
