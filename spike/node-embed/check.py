"""Runs same-PID and loader assertions plus unchanged parity tests."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--package', type=Path, required=True)
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--logs', type=Path, required=True)
args = parser.parse_args()
subprocess.run(['python3', str(Path(__file__).with_name('callback-lock-test.py'))], check=True, timeout=30)
subprocess.run(['python3', str(Path(__file__).with_name('dylib-paths-test.py'))], check=True, timeout=30)
package = args.package.resolve()
repo = args.repo.resolve()
args.logs.mkdir(parents=True, exist_ok=False)
manifest = json.loads((package / 'manifest.json').read_text())
engines = json.loads((repo / 'package.json').read_text())['engines']['node']
minimum = re.fullmatch(r'>=(\d+)\.(\d+)', engines)
if not minimum:
    raise RuntimeError('engine rule changed; use the repository package manager check')
assert tuple(map(int, manifest['node'].split('.')[:2])) >= tuple(map(int, minimum.groups()))
assert manifest['node'] in ['26.7.0', '24.21.0'], 'candidate not explicitly pinned'
assert manifest['imsgRevision'] == '4aa95deb46ddbd92419b3b47717d9bf8acbca3d3'
results = []
with tempfile.TemporaryDirectory(prefix='embed-home-') as home:
    env = {'HOME': home, 'PATH': '/usr/bin:/bin', 'DYLD_PRINT_LIBRARIES': '1'}
    files = ['probe', 'library', 'forced', 'exit', 'load-error', 'stream', 'stream-exit', 'metadata', 'changes', 'api', 'service', 'update', 'backup', 'artifact', 'fixtures']
    for name in files:
        command = [str(package / 'EmbeddedHost'), str(package / (name + '.cjs' if name in ['probe','library','forced','exit','load-error','stream','stream-exit','metadata', 'changes'] else 'suite.cjs')), str(repo if name in ['probe','library','forced','exit','load-error','stream','stream-exit','metadata', 'changes'] else repo / 'server/test' / (name + '.test.js'))]
        try:
            result = subprocess.run(command, cwd=repo, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
            text = result.stdout
            code = result.returncode
        except subprocess.TimeoutExpired as error:
            text = (error.stdout or b'').decode() if isinstance(error.stdout, bytes) else (error.stdout or '')
            code = 124
        (args.logs / (name + '.log')).write_text(text)
        ticks = re.search(r'SWIFT_MAIN_LOOP_TICKS=(\d+) PID=(\d+) RETURN=(\d+)', text)
        expected = 7 if name in ['exit','stream-exit'] else 1 if name in ['forced','load-error'] else 0
        assert ticks and int(ticks[1]) > 0 and int(ticks[3]) == expected, name + ' main loop/return failure'
        assert code == expected, name + ' exit ' + str(code)
        loaded = [line for line in text.splitlines() if line.startswith('dyld[') and re.search(r'\.dylib$',line)]
        assert not any('/opt/homebrew/' in line for line in loaded), name + ' ambient runtime'
        assert any(str(package / 'lib/libnode') in line for line in loaded), name + ' missing bundled libnode'
        if name == 'probe':
            assert 'RUNTIME_NODE_VERSION=' + manifest['node'] + ' ABI=' in text
            assert 'NATIVE_ASYNC_CANCEL_AFFINITY_WORKER_ESM_SQLITE_HTTP_WS_PASS PID=' + ticks[2] in text
            assert 'GRACEFUL_NATIVE_DRAIN_PENDING PID=' + ticks[2] in text
            assert 'SIGNAL_NATIVE_DRAIN_PASS PID=' + ticks[2] in text
        elif name == 'library':
            assert 'PINNED_LIBRARY_16_REPLIES_SAME_PID_PASS PID=' + ticks[2] in text
            assert 'PINNED_CORE_SYNTHETIC_HISTORY_PASS PID=' + ticks[2] in text
            assert 'UNCHANGED_JS_RPC_NATIVE_READ_ERRORS_PASS PID=' + ticks[2] in text
            assert 'PINNED_LIBRARY_SYNTHETIC_WATCH_UNSUBSCRIBE_PASS PID=' + ticks[2] in text
        elif name == 'changes':
            assert 'NATIVE_CHANGES_DIFFERENTIAL_RESTART_BOUNDARIES_ENGINE_PASS PID=' + ticks[2] in text
        elif name == 'metadata':
            assert 'NATIVE_METADATA_DIFFERENTIAL_READONLY_CONSUMERS_PASS PID=' + ticks[2] in text
        elif name == 'stream':
            assert 'NATIVE_STREAM_SERVER_AUTH_WS_STATE_DRAIN_PASS PID=' + ticks[2] in text
            assert 'NATIVE_STREAM_BACKPRESSURE_CANCEL_LIBRARY_PASS PID=' + ticks[2] in text
        elif name in ['forced','exit','load-error','stream-exit']:
            assert 'FORCED_NATIVE_DRAIN_PASS' in text
            assert 'LATE_NATIVE_COMPLETION' not in text
        else:
            assert re.search(r'fail 0(?:\n|$)',text), name + ' test failures'
        counts = [line for line in text.splitlines() if re.search(r'(tests |pass |fail |skipped )\d+',line)]
        results.append({'file': name, 'pid': int(ticks[2]), 'ticks':int(ticks[1]), 'counts':counts, 'exit':code})
        print(json.dumps(results[-1]),flush=True)
(args.logs / 'results.json').write_text(json.dumps({'candidate':manifest,'repoEngines':engines,'results':results},indent=2))
print('THREADED_PARITY_PASS',len(results))
