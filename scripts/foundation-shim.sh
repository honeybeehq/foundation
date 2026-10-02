#!/bin/sh
FDN_ROOT="${FDN_ROOT:-$HOME/Projects/honeybee/foundation/repos/foundation}"
if [ "$1" = session ]; then
  exec node "$FDN_ROOT/packages/cli/bin/session.mjs" "$@"
fi
exec "$FDN_ROOT/node_modules/.bin/tsx" "$FDN_ROOT/packages/cli/src/main.ts" "$@"
