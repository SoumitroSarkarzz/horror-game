"""Run browser QA with optional loopback-only coturn TCP relay.

Cloud Chromium may prohibit direct WebRTC UDP. This uses a supported TCP relay,
not a browser-policy override. No private test credential enters the repository.
This harness does not prove remote-network reliability.
"""
import os
import pathlib
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

project = pathlib.Path(__file__).resolve().parents[1]
command = ['npx', 'playwright', 'test', *sys.argv[1:]]
if os.environ.get('TURN_URL') and os.environ.get('TURN_SECRET'):
    raise SystemExit(subprocess.run(command, cwd=project).returncode)
root = pathlib.Path(os.environ.get('AFTERLIGHT_TOOLS_DIR', '/workspace/.afterlight-tools')) / 'turn' / 'root'
binary = os.environ.get('TURN_BIN') or shutil.which('turnserver')
if not binary and (root / 'usr/bin/turnserver').exists():
    binary = str(root / 'usr/bin/turnserver')
if not binary:
    # Ordinary browser installations can use host candidates; restricted cloud
    # installations require install-test-turn.sh or supplied TURN configuration.
    raise SystemExit(subprocess.run(command, cwd=project).returncode)
with tempfile.TemporaryDirectory(prefix='afterlight-turn-') as temporary:
    folder = pathlib.Path(temporary)
    secret = secrets.token_hex(32)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    config = folder / 'test.conf'
    config.write_text(f'''listening-port={port}
listening-ip=127.0.0.1
relay-ip=127.0.0.1
realm=afterlight-local-test
use-auth-secret
static-auth-secret={secret}
no-tls
no-dtls
no-cli
allow-loopback-peers
log-file={folder}/turn.log
pidfile={folder}/turn.pid
min-port=49160
max-port=49200
''')
    config.chmod(0o600)
    turn_environment = os.environ.copy()
    libraries = [str(p) for p in (root / 'usr/lib').glob('*-linux-gnu')]
    if libraries:
        turn_environment['LD_LIBRARY_PATH'] = ':'.join(libraries + ([os.environ['LD_LIBRARY_PATH']] if os.environ.get('LD_LIBRARY_PATH') else []))
    with (folder / 'process.log').open('w') as log:
        relay = subprocess.Popen([binary, '-c', str(config)], env=turn_environment, stdout=log, stderr=log)
        try:
            for attempt in range(50):
                if relay.poll() is not None:
                    raise RuntimeError('Local test relay failed to start. Check coturn dependencies.')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Local test relay did not become ready')
            environment = os.environ.copy()
            environment['TURN_URL'] = f'turn:127.0.0.1:{port}?transport=tcp'
            environment['TURN_SECRET'] = secret
            result = subprocess.run(command, cwd=project, env=environment)
        finally:
            relay.terminate()
            relay.wait(timeout=10)
    raise SystemExit(result.returncode)
