# September 2026 additive iNaturalist import

This batch contains only the 979 approved iNaturalist IDs absent from the historical
`public/Until_June26.csv`. It adds to the 12,674 historical observations. It does not
replace either historical CSV, update `user_groups.csv`, or change enrichment data.

## Source and reproduction

- Workbook: `all observations until September 2026 (3).xlsx`.
- SHA-256: `f261a8c4abeed8909fee64a1947c76b7535e00177ee3381c258c5d56582df16d`.
- Worksheet: `all observations until Septembe`.
- 12,343 rows, 22 columns, 9,989 unique non-null original iNaturalist IDs.
- 9,010 iNaturalist and 2,354 MERLIN records are already represented.
- All 1,310 historical records absent from the workbook remain in the dashboard.
- The 167 historical quality differences are not applied.

Run with Python 3 (standard library only):

```text
python scripts/prepare-inaturalist-additions.py "PATH/TO/all observations until September 2026 (3).xlsx" --write
python scripts/prepare-inaturalist-additions.py "PATH/TO/all observations until September 2026 (3).xlsx"
```

The first command writes only `public/inaturalist-september-2026-additions.json`.
An identical rerun does not rewrite it. The second command checks byte-for-byte
reproducibility. Unexpected workbook hashes, duplicate IDs or counts are errors,
not reasons to alter records. A later batch requires its own reconciliation and
approval. Neither the workbook nor Python is required to load the dashboard.

## Field mapping

| Excel value                         | Dashboard treatment                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `originalRecordId`                  | Authoritative identity: `inat_<originalRecordId>`                                                                                                         |
| `composite_id`                      | Original platform identifier retained in `source_metadata.values`                                                                                         |
| `observed_on`                       | Excel 1900-system serial decoded to `DD/MM/YYYY` and `HH:MM:SS`, then validated by the existing date/time parsers                                         |
| `latitude`, `longitude`             | Validated numeric coordinates; original decimal strings also retained                                                                                     |
| `scientific_name`                   | Existing scientific-name field                                                                                                                            |
| `hebrew_name`                       | Existing common-name field; blank/`NULL` stays absent                                                                                                     |
| `quality_grade`                     | Original `research`, `needs_id` or `casual` value                                                                                                         |
| `user_login`                        | Existing observer identifier                                                                                                                              |
| `user_category`, `user_subcategory` | Observation-level mapping below; no global user-map override                                                                                              |
| `source_url`                        | Original link retained verbatim in source metadata (usually a photograph). The main observation link is constructed from the authoritative iNaturalist ID |
| All 22 original columns             | Preserved verbatim in `source_metadata.values`, including English names, user details, Hebrew group labels, taxonomy labels and species flags             |

The workbook supplies no original `iconic_taxon_name`, `taxon_order_name` or
`establishment_means`. They are not invented. Scientific-name classification and
English display-name lookup continue to use the existing dashboard dictionaries.
The 157 new records without Hebrew names remain without an imported Hebrew name.

Excel dates have integral-second precision. Decimal storage noise is below
0.4 microseconds. The generator rounds that noise to the nearest second and
rejects meaningful subsecond values rather than silently discarding them. It
does not apply a timezone, and retains the original serial for traceability.

## Approved group policy

| Excel main group / subgroup             | Dashboard main group / subgroup | New records | Total after import |
| --------------------------------------- | ------------------------------- | ----------: | -----------------: |
| online communities / online communities | online_communities / community  |         640 |              7,868 |
| local communities / zevulun             | local_communities / zevulun     |         279 |              1,625 |
| local communities / yizrael             | local_communities / yizrael     |          44 |                339 |
| local communities / mechinistim         | local_communities / mechnistim  |           4 |                355 |
| students / students                     | local_communities / student     |          12 |              1,109 |
| Historical professional monitoring      | expert / expert                 |           0 |              2,357 |

The new main-group totals are 640 online and 339 local. All 62 conflicting new
records (11 users) use their Excel groups. The 477 historical records belonging
to these users retain their existing assignments. No classification is assigned
to all of a user's observations based on a new record.

## Loading and duplicate prevention

The existing loader reads its historical sources unchanged, fetches the separate
JSON, and calls `appendInaturalistAdditions`. Existing canonical source IDs win.
The function does not mutate existing objects, rejects duplicate IDs inside the
batch, validates dates, coordinates, grades and approved group pairs, and appends
only absent IDs. Reapplying the same batch returns the same records in the same
order. Counters, date bounds, monitoring memberships and all views consume the
combined array through the existing shared provider.

Records `264804474`, `401017628` and `401017800` are retained as three distinct
source observation IDs. They may describe repeated biological encounters; no
deduplication by species, coordinates, observer or date is performed.

## Expected counts

- Total: 13,653 (11,296 iNaturalist; 2,357 MERLIN).
- New quality: 518 research, 431 needs_id, 30 casual.
- Final quality: 8,317 research, 5,306 needs_id, 30 casual.
- July–September 2026: 885 additions (280, 360 and 245 respectively).
- Earlier months: 94 additions, retained by source identity rather than a date cutoff.

## Separate classification discrepancies

The current taxonomy dictionaries and Excel disagree for 418 additions across
215 scientific names. These differences are not resolved by this import:

| Excel category | Current dashboard category | Records |
| -------------- | -------------------------- | ------: |
| Birds          | arthropods                 |      43 |
| Birds          | other                      |       3 |
| Other Species  | plants                     |      83 |
| Other Species  | arthropods                 |      53 |
| Dragonflies    | other                      |      23 |
| Butterflies    | other                      |     211 |
| Mammals        | other                      |       2 |

For example, the existing dictionary already classifies all six historical
`Ardea cinerea` records as arthropods. Some other names are absent from the
dictionary, while Excel's broad `Other Species` label also disagrees with known
plant/arthropod classifications. Neither source is globally assumed correct.
All observations remain visible when all taxa are selected. Individual taxa
filters retain the current dictionary behavior. These are a separate review
item before publication, not a change to approved quality or user groups.

Five new records have `is_invasive=0` in Excel but the current registry labels
their species invasive: `385308931`, `387529441`, `395133976`, `395136939`,
`401223113`. Original flags remain in source metadata; the registry is unchanged.

## Validation

`npm run test:import` exercises the actual asynchronous production loader with
local public assets, then the real filtering/chart/map/export callbacks. Tests
cover preservation of the historical runtime fingerprint, idempotence, rejection
of invalid inputs, raw Excel dates in four host timezones, all eight quality
combinations, group conflicts, monthly/seasonal outputs, map details, monitoring
memberships, species/user counts and Hebrew/English CSV exports.

The existing date, enrichment and People tests deliberately continue to exercise
the 12,674-record historical baseline. The import tests separately verify the
full 13,653-record production load. No historical expected counts are rewritten
to mask a regression.
