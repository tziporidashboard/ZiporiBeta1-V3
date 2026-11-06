# MERLIN expert snapshot — November 6, 2026

This release transfers the approved development update from commit
`5848e29987bd2bf10e24dab603c93a5cf5904c1f` onto official main
`c478c4d61b739a8d7ba3f95133b33a54beb8c053`.

The active file is `public/merlin-experts-2026-11-06.csv`, the revised export
received on November 6 at 18:48 (Asia/Jerusalem). It contains 3,664 observations
and 22 columns; SHA-256 is
`7d1d516e7a51b8fb7eaffc5a2ca71b76e57d19e89d1a6d714796d4bfc2ca6a34`.

All 2,644 existing MERLIN IDs remain. There are 1,020 added observations from
Rea Shaish, all from 2026. The only changed existing record is 113424: its
coordinates now come directly from the source as `32.745815,35.221931`.
The temporary coordinate override has been removed. Empty sessions 114696,
114697 and 114782 remain absent. Missing records in future exports still
require an explicit review; this release introduces no automatic deletion rule.

| Measure | Count |
|---|---:|
| Total observations | 14,960 |
| MERLIN | 3,664 |
| iNaturalist | 11,296 |
| MERLIN in 2026 | 1,310 |
| Rea Shaish | 2,438 |

iNaturalist data and community memberships, shared species dictionaries,
MERLIN classification policy and existing dashboard features are unchanged.
Because of the corrected position, observation 113424 now belongs to monitoring
area 4 only (previously areas 4 and 5); it remains outside the fixed survey areas.
Professional questions recorded during earlier reviews remain unchanged.

The previous snapshot and a complete Git recovery bundle were verified and
saved locally outside this repository before release. No historical backup or
detailed reconciliation report is published. `npm run audit:merlin` regenerates
the ignored `comparison.json`; historical regression tests read the approved
source blobs from Git history. Official repository history references and
cross-platform line-ending checks are preserved.

Pre-release verification on the official code passed all 108 automated tests,
TypeScript and a local Vercel-target build. One existing iNaturalist checksum
test initially detected only Windows checkout CRLF conversion; its entire
17-test file passed after restoring the exact existing Git blob locally.
No iNaturalist content or test logic is included in this change. The data audit
matches the approved development result, including every existing observation,
all 1,020 additions, area memberships and both CSV exports. Build warnings about
large chunks and dependency directives remain non-blocking.
