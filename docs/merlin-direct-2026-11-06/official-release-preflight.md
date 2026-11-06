# MERLIN direct loading — official release preflight

Approved source: development commit `7506dc2997f3acd88481f0c89894cfe2133a61ed`.
Target: `tziporidashboard/ZiporiBeta1-V3`, branch `main`,
`https://zipori-beta1-v3.vercel.app/`.

## Integration and scope

The official main head before integration is
`b6a19d8a80805cf81fed3ec78d8af5e177b4bca2`, tree
`480a6e83ebba56e6a649f5b0a263678f05baeb68`. GitHub reports a successful
Vercel deployment for this commit in `tzipori/zipori-beta1-v3`.

Changes were applied as a patch onto that exact official revision in an isolated
worktree. The active loader, MERLIN converter and package scripts match the
approved development commit. Existing official components and features,
iNaturalist assets/community assignments, shared species dictionaries,
monitoring polygons, dependency lockfile and snapshot line-ending policy remain
unchanged.

Existing cross-platform checksum checks in official tests were retained.
The offline historical test helper references the official parent commit instead
of the development repository's commit. This changes test/recovery provenance
only, not runtime behavior or observations. Detailed comparison reports and the
full historical backup are excluded from the public commit.

## Data and recovery

- 13,940 unique observations: 2,644 MERLIN and 11,296 iNaturalist.
- 290 MERLIN observations from 2026.
- Only empty sessions 114696, 114697 and 114782 leave the active dataset.
- Only observation 113424 with source position 0,0 receives the reviewed temporary
  position 32.74648,35.218938. No new professional corrections are made.
- Remaining names, classifications, generic identifications and exported data
  match the approved development behavior and previous official export after
  excluding the three approved sessions.
- The complete 2,357-row, 88-column historical CSV was verified before removal
  from public assets. Its local backup is 2,252,206 bytes, SHA-256
  `42438b9a029b8ba81ff8625e7a28b8863adde48a70c69b5d30d3823981de8b75`.
- A second local copy and a verified Git bundle containing the complete official
  history through `b6a19d8` were saved outside the repository. No backup or bundle
  is uploaded. The same CSV can also be recovered from that immutable official
  commit; its historical Git presence is not rewritten.

## Validation and publication safeguards

- All 108 automated tests passed, with no failures or skips, on the integrated
  official code. Tests cover record equality, unique IDs, taxonomy, dates,
  coordinates, maps, regions, drawn polygons, tables, charts and both CSV languages.
- TypeScript passed with `npx tsc --noEmit`.
- The Vercel-target build passed locally with Node 24.19.0. Existing third-party
  bundling and chunk-size warnings are non-fatal. The historical CSV is absent
  from public build output, and the new snapshot is present.
- Windows checkout newline conversion was corrected locally to match the
  unchanged committed bytes of the iNaturalist JSON snapshot. No data change is
  included in the commit.
- Publication uses the approved GitHub connection, one tree and one commit with
  the latest verified official main as parent. The branch update requires the
  expected parent SHA and uses `force=false`.
- The official site and export will be checked again after Vercel completes.
