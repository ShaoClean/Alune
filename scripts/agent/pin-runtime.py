"""Regenerate runtime-pins.json from official archives and their verified SHASUMS256.txt.

Usage: python3 scripts/agent/pin-runtime.py 22.22.0 /path/to/node-dist > scripts/agent/runtime-pins.json
"""
import hashlib
import json
import pathlib
import sys
import tarfile
import zipfile


def fingerprint(stream):
    h, count = hashlib.sha256(), 0
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        count += len(chunk)
        h.update(chunk)
    return h.hexdigest(), count


def pins(version, directory):
    sums = {name: digest for digest, name in
            (line.split() for line in (directory / 'SHASUMS256.txt').read_text().splitlines() if line.strip())}
    result = {}
    for target in ('darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'):
        windows = target == 'win32-x64'
        prefix = 'node-v' + version + '-' + target.replace('win32-', 'win-')
        name = prefix + ('.zip' if windows else '.tar.gz')
        archive = directory / name
        with archive.open('rb') as source:
            digest, _ = fingerprint(source)
        if digest != sums[name]:
            raise ValueError(f'Archive does not match official checksum: {name}')
        row = {'archive': name, 'archiveSha256': digest}
        with (zipfile.ZipFile(archive) if windows else tarfile.open(archive, 'r:gz')) as src:
            for key, filename in [('executable', 'node.exe' if windows else 'bin/node'), ('license', 'LICENSE')]:
                member = prefix + '/' + filename
                with (src.open(member) if windows else src.extractfile(member)) as stream:
                    row[key + 'Sha256'], row[key + 'Bytes'] = fingerprint(stream)
        result[target] = row
    return {'version': version, 'targets': result}


if __name__ == '__main__':
    print(json.dumps(pins(sys.argv[1], pathlib.Path(sys.argv[2])), indent=2))
