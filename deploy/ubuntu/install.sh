#!/usr/bin/env bash
# Run only after uploading and extracting the prepared release into a fresh directory.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run this installer as root.'; exit 1; }
release="$(realpath -e -- "${1:?Fresh release directory required}")"
case "$release" in /opt/gugis/releases/*) ;; *) echo 'Release must be inside /opt/gugis/releases'; exit 1 ;; esac
test ! -e "$release/.local" || { echo 'Release already configured; choose a fresh release.'; exit 1; }
password_file="${2:-/root/gugis-site-password}"
if ! test -s /etc/nginx/gugis.htpasswd; then
    test -f "$password_file" || { echo 'Provide a separately uploaded website password file.'; exit 1; }
    test "$(stat -c %a "$password_file")" = 600 || { echo 'Password file must be chmod 600.'; exit 1; }
fi
# Do not bind a second application onto another site's API port.
if ss -ltn '( sport = :8001 )' | grep -q ':8001' && ! systemctl is-active --quiet gugis-api; then
    echo 'Port 8001 belongs to another service; stop and review the deployment.'; exit 1
fi
python3 "$release/deploy/verify_release.py" "$release"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-upgrade nginx python3-venv python3-pip ca-certificates openssl curl
test "$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')" = '3.10' || {
    echo 'This lock targets Ubuntu 22.04 Python 3.10; inspect the runtime first.'; exit 1;
}
id gugis >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gugis --shell /usr/sbin/nologin gugis
install -d -m 755 /opt/gugis /opt/gugis/releases /var/www/gugis-acme
install -d -m 750 -o gugis -g gugis /var/lib/gugis
python3 -m venv "$release/.server-venv"
"$release/.server-venv/bin/python" -m pip install --only-binary=:all: -r "$release/deploy/ubuntu/requirements-python310.txt"
"$release/.server-venv/bin/python" "$release/deploy/ubuntu/refresh_runtime_receipt.py"
# Read-only public derivatives use the release, while edits/history survive updates.
ln -s /var/lib/gugis "$release/.local"
if test -e /var/lib/gugis/render-cache && ! test -L /var/lib/gugis/render-cache; then
    echo 'An existing render-cache directory needs review; it was not overwritten.'; exit 1
fi
ln -sfn /opt/gugis/current/render-cache /var/lib/gugis/render-cache
if ! test -s /etc/nginx/gugis.htpasswd; then
    password_hash="$(openssl passwd -6 -stdin < "$password_file")"
    printf 'gugis:%s\n' "$password_hash" > /etc/nginx/gugis.htpasswd
    chown root:www-data /etc/nginx/gugis.htpasswd
    chmod 640 /etc/nginx/gugis.htpasswd
    unset password_hash
fi
# Reuse the existing valid IP certificate and its active renewal timer.
# Existing HTTP GUGIS and HTTPS shop listeners remain unchanged.
openssl x509 -in /etc/letsencrypt/live/bristol-shop-ip/fullchain.pem -noout -checkip 123.56.47.218
openssl x509 -in /etc/letsencrypt/live/bristol-shop-ip/fullchain.pem -noout -checkend 86400
systemctl is-active --quiet bristol-cert-renew.timer
previous=''
if test -L /opt/gugis/current; then previous="$(readlink -f /opt/gugis/current)"; fi
ln -s "$release" /opt/gugis/current.next
mv -Tf /opt/gugis/current.next /opt/gugis/current
cp "$release/deploy/ubuntu/gugis-api.service" /etc/systemd/system/gugis-api.service
systemctl daemon-reload
systemctl enable gugis-api
systemctl restart gugis-api
ready=0
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:8001/health; then ready=1; break; fi
    sleep 1
done
if test "$ready" != 1; then
    if test -n "$previous"; then
        ln -s "$previous" /opt/gugis/current.rollback
        mv -Tf /opt/gugis/current.rollback /opt/gugis/current
        systemctl restart gugis-api
    fi
    echo 'New API failed health check; inspect journalctl -u gugis-api.'; exit 1
fi
cp "$release/deploy/ubuntu/nginx-https.conf" /etc/nginx/sites-available/gugis-https
ln -sfn /etc/nginx/sites-available/gugis-https /etc/nginx/sites-enabled/gugis-https
nginx -t
systemctl reload nginx
echo 'GUGIS service configured at https://123.56.47.218:8443/. Verify the actual browser before reporting online.'
