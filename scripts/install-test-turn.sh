#!/usr/bin/env bash
set -euo pipefail
# Optional Debian 13 cloud QA tool; installs nothing into system directories.
# APT authenticates the Release metadata with the official Debian archive keyring
# and checks downloaded package digests. Never disable these checks.
tools_base="${AFTERLIGHT_TOOLS_DIR:-/tmp/afterlight-tools}/turn"
mkdir -p "$tools_base/lists/partial" "$tools_base/cache/archives/partial" "$tools_base/packages" "$tools_base/empty-config"
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$tools_base/sources.list"
cat > "$tools_base/apt.conf" <<'CONF'
#clear APT::Update::Post-Invoke;
#clear APT::Update::Post-Invoke-Success;
CONF
apt_flags=(-c "$tools_base/apt.conf" -o "Dir::Etc::parts=$tools_base/empty-config" -o "Dir::Etc::sourcelist=$tools_base/sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$tools_base/lists" -o "Dir::Cache=$tools_base/cache" -o Acquire::Retries=0)
apt-get "${apt_flags[@]}" update
cd "$tools_base/packages"
apt-get "${apt_flags[@]}" download coturn libhiredis1.1.0 libevent-extra-2.1-7t64 libevent-openssl-2.1-7t64
for package_file in *.deb; do dpkg-deb -x "$package_file" "$tools_base/root"; done
printf 'Local test TURN extracted to %s\n' "$tools_base/root"
