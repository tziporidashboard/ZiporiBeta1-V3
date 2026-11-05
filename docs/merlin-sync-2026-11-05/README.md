# MERLIN synchronization, 2026-11-05

This release transfers the validated MERLIN update from development commit
`e1d5c397962459aca8ea34fdbd97b5977d11de27` onto official `main` at
`c0460692cb418ea58c90cf06a92963f438871dda`.

The new snapshot updates 2,354 matching source identifiers and adds 290 new
observations. Three historical sessions absent from the export are retained.
The resulting dataset contains 13,943 unique observations: 2,647 MERLIN and
11,296 unchanged iNaturalist observations. All 290 additions are from 2026.

Historical MERLIN data remains in its original file, including fields absent
from the new export. Applying the same snapshot twice is idempotent. A source
coordinate of 0,0 on observation 113424 retains its previous valid location.
Taxonomy and display overrides apply to MERLIN records only; shared dictionaries
and community assignments remain unchanged. The 52 observations awaiting
professional clarification retain the handling validated in development.

The official polygon, region filters and species map fixes are preserved.
The transfer requires no dependency changes. Existing line-ending portability
checks are retained, and the new protected-file hash test also accepts LF/CRLF
checkout differences without accepting changes to data or other whitespace.
The approved new snapshot is pinned to LF in `.gitattributes`, preserving its
exact source checksum on Windows and Linux.

## Validation

Run these separately to avoid concurrent memory pressure:

```text
node --test --test-concurrency=1 tests/*.test.mjs
npx tsc --noEmit
npm run build
```

For a local Vercel-target build, set `VERCEL=1` for the build process only.
The MERLIN tests verify complete loading, source/monitor/year counts, all shared
record updates, unique identifiers, repeat synchronization, preserved historical
fields, exceptional records, maps, area membership, taxonomy and CSV exports.

`npm run audit:merlin` reproduces detailed reconciliation and exception files
in this directory. Those detailed working reports are retained separately and
are not part of the public release. Review generated reports before publishing.

## Recovery

The pre-release official commit is
`c0460692cb418ea58c90cf06a92963f438871dda`. A full Git bundle of that version is
retained locally, with a remote recovery branch created before publication.
If a full rollback is required, revert the MERLIN release commit on the latest
official main and deploy the resulting new commit; do not reset or force-push.
For a data-only rollback, `MERLIN_SYNC_ENABLED` can be disabled and the unchanged
historical sources reloaded. Either rollback is a separate deployment decision.
