"""Disposable macOS feasibility package. Requires an existing Node shared build."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
from dylib_paths import executable_dependency

parser = argparse.ArgumentParser()
parser.add_argument('--node-prefix', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--native-library', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
prefix = args.node_prefix.resolve()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
lib = output / 'lib'
lib.mkdir()

def run(*command):
    return subprocess.check_output([str(x) for x in command], text=True, timeout=60)

def dependencies(file):
    return [line.strip().split(' (')[0] for line in run('otool', '-L', file).splitlines()[1:]]

seen = {}
def stage(file):
    file = Path(file).resolve()
    if file in seen:
        return seen[file]
    target = lib / file.name
    if target.exists():
        raise RuntimeError('dylib basename collision: ' + file.name)
    seen[file] = target
    shutil.copy2(file, target)
    os.chmod(target, 0o755)
    for dep in dependencies(file):
        if dep.startswith('@rpath/libswift'):
            continue
        resolved = file.parent / dep.split('/', 1)[1] if dep.startswith(('@rpath/', '@loader_path/')) else Path(dep)
        if str(resolved).startswith(('/usr/lib/', '/System/')):
            continue
        if resolved.resolve() == file:
            continue
        child = stage(resolved)
        run('install_name_tool', '-change', dep, '@loader_path/' + child.name, target)
    run('install_name_tool', '-id', '@rpath/' + target.name, target)
    return target

nodes = list((prefix / 'lib').glob('libnode.*.dylib'))
if len(nodes) != 1:
    raise RuntimeError('expected one versioned libnode')
node = nodes[0]
imsg_revision = '4aa95deb46ddbd92419b3b47717d9bf8acbca3d3'
checkout = source / 'NativeHost/out/checkouts/imsg'
if run('git', '-C', checkout, 'rev-parse', 'HEAD').strip() != imsg_revision:
    raise RuntimeError('native checkout does not match pinned imsg revision')
uv = next(dep for dep in dependencies(node) if 'libuv.' in dep)
run('xcrun', 'clang++', '-std=c++20', '-I' + str(prefix / 'include/node'), '-I' + str(Path(uv).parent.parent / 'include'), '-c', source / 'embed.cc', '-o', output / 'embed.o')
host = output / 'EmbeddedHost'
run('xcrun', 'swiftc', source / 'main.swift', output / 'embed.o', '-import-objc-header', source / 'bridge.h', node, uv, args.native_library.resolve(), '-lc++', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/lib', '-o', host)
for dep in dependencies(host):
    if dep.startswith(('/usr/lib/', '/System/', '@rpath/libswift')):
        continue
    resolved = executable_dependency(dep, node, args.native_library.resolve())
    child = stage(resolved)
    run('install_name_tool', '-change', dep, '@executable_path/lib/' + child.name, host)
for target in [*seen.values(), host]:
    run('codesign', '--force', '--sign', '-', target)
    run('codesign', '--verify', '--strict', target)
    for dep in dependencies(target):
        if not dep.startswith(('/usr/lib/', '/System/', '@rpath/', '@loader_path/', '@executable_path/')):
            raise RuntimeError('ambient dependency: ' + dep)
for name in ['probe.cjs', 'suite.cjs', 'library.cjs', 'forced.cjs', 'exit.cjs', 'load-error.cjs', 'stream.cjs', 'stream-transport.cjs', 'stream-exit.cjs', 'metadata.cjs', 'metadata-readers.cjs', 'changes.cjs', 'change-reader.cjs']:
    shutil.copy2(source / name, output / name)
header = (prefix / 'include/node/node_version.h').read_text()
version = '.'.join(re.search(r'#define NODE_' + part + r'_VERSION\s+(\d+)', header).group(1) for part in ['MAJOR', 'MINOR', 'PATCH'])
(output / 'manifest.json').write_text(json.dumps({'node': version, 'dylibs': len(seen), 'adhoc': True, 'imsgRevision': imsg_revision, 'nativeSha256': hashlib.sha256(args.native_library.read_bytes()).hexdigest()}, indent=2))
print('PACKAGE_PASS', version, len(seen))
