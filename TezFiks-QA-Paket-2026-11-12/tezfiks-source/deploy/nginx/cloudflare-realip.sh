#!/bin/sh
# Writes the nginx snippet that restores visitor addresses behind Cloudflare for the TezFiks locations
# (included by deploy/nginx/tezfiks.conf). Run as root on the server, then `nginx -t && systemctl reload nginx`.
# Cloudflare changes its ranges rarely; re-run this monthly (or from cron).
set -eu
out="${1:-/etc/nginx/snippets/tezfiks-cloudflare-realip.conf}"
tmp="$(mktemp)"
{
  echo "# Cloudflare ranges fetched $(date -u +%F) from https://www.cloudflare.com/ips/ (deploy/nginx/cloudflare-realip.sh)."
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$tmp"
# Refuse to install an empty list (network error): nginx would then trust nobody and log Cloudflare's addresses.
grep -q '^set_real_ip_from ' "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$out"
echo "wrote $out ($(grep -c '^set_real_ip_from ' "$out") ranges)"
