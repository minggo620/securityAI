#!/bin/sh
# SQL is read from stdin. Never enable tracing or put credentials in arguments.
set +x
set -eu

fail() { printf '%s\n' "$1" >&2; exit 1; }
tls_mode=${1:-PREFERRED}
[ "$#" -le 1 ] || fail 'AUTH_REQUIRED: unexpected arguments'
case "$tls_mode" in PREFERRED|VERIFY_IDENTITY) ;; *) fail 'AUTH_REQUIRED: invalid TLS mode' ;; esac
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
profile_file="$script_dir/../../DATABASE.md"
field() {
  awk -v key="$1" 'index($0, "- " key ": `") == 1 { sub("^- " key ": `", ""); sub("`.*$", ""); print; exit }' "$profile_file"
}
db_host=${AI_SECURITY_DB_HOST:-$(field Host)}
db_port=${AI_SECURITY_DB_PORT:-$(field Port)}
db_port=${db_port:-3306}
db_user=${AI_SECURITY_DB_USER:-$(field User)}
db_name=${AI_SECURITY_DB_NAME:-$(field Database)}
MYSQL_PWD=${MYSQL_PWD:-$(field Password)}
[ -n "$db_host" ] && [ -n "$db_user" ] && [ -n "$MYSQL_PWD" ] || fail 'AUTH_REQUIRED: incomplete configuration'
[ "$db_name" = ai_security ] || fail 'SCHEMA_INCOMPATIBLE: only ai_security is permitted'
case "$db_port" in ''|*[!0-9]*) fail 'AUTH_REQUIRED: invalid port' ;; esac
[ "${#db_port}" -le 5 ] && [ "$db_port" -ge 1 ] && [ "$db_port" -le 65535 ] || fail 'AUTH_REQUIRED: invalid port'
command -v mysql >/dev/null 2>&1 || fail 'MYSQL_CLIENT_UNAVAILABLE: mysql client is unavailable'
export MYSQL_PWD
# exec preserves the caller's timeout/signal behavior: no background child remains.
exec mysql --host="$db_host" --port="$db_port" --user="$db_user" \
  --database="$db_name" --connect-timeout=30 --ssl-mode="$tls_mode" \
  --default-character-set=utf8mb4 --batch --raw --skip-column-names
