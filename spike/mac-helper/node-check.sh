#!/bin/bash
# Run by an agent whose responsible process is node: shows that, then tries to open the Messages
# database from node -e. Before node's Full Disk Access is turned off this opens; after, it fails.
set -uo pipefail
sudo -n launchctl procinfo $$ 2>&1 | grep -E '^responsible path = '
node -e '
const { DatabaseSync } = require("node:sqlite");
try {
  const db = new DatabaseSync(require("node:os").homedir() + "/Library/Messages/chat.db", { readOnly: true });
  console.log("OPENED", db.prepare("SELECT COUNT(*) AS n FROM message").get().n);
} catch (e) {
  console.log("FAILED", e.code ?? "", e.errcode ?? "", e.message);
}'
