import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MERLIN_ARCHIVE_PATH =
  "data-archive/merlin/2026-11-05/MERLIN all observations for Zohar.csv";
const root = fileURLToPath(new URL("../../", import.meta.url));
const historicalObject =
  "b6a19d8a80805cf81fed3ec78d8af5e177b4bca2:public/MERLIN all observations for Zohar.csv";

/** Offline audit only: the private local backup is never a published test asset. */
export function readMerlinHistory({ fromGit = false } = {}) {
  const localPath = resolve(root, MERLIN_ARCHIVE_PATH);
  const bytes =
    !fromGit && existsSync(localPath)
      ? readFileSync(localPath)
      : Buffer.from(
          execFileSync("git", ["show", historicalObject], {
            cwd: root,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
          })
            .toString("utf8")
            // Git stores LF; the approved original Windows backup uses CRLF.
            .replace(/\r?\n/g, "\r\n"),
        );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "42438b9a029b8ba81ff8625e7a28b8863adde48a70c69b5d30d3823981de8b75",
    "Historical MERLIN source differs from the approved backup",
  );
  return bytes;
}
