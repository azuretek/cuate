"""Build a pinned shared runtime in a scratch source tree, without installing anything."""
import argparse
from pathlib import Path
import subprocess
import ast
import os
import signal
p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,required=True)
p.add_argument('--libuv-prefix',type=Path,required=True)
p.add_argument('--state',type=Path,required=True)
p.add_argument('--jobs',type=int,default=4)
p.add_argument('--resume',action='store_true')
p.add_argument('--deadline',type=int,default=900)
a=p.parse_args();root=a.source.resolve();uv=a.libuv_prefix.absolute()
assert 1<=a.jobs<=8 and 30<=a.deadline<=1800
assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True,timeout=10).strip()=='955266bfdd854cd280dffd47548673914484e4c0'
assert (uv/'include/uv.h').is_file()
a.state.write_text('running')
try:
    if a.resume:
        config=ast.literal_eval((root/'config.gypi').read_text())['variables']
        assert config['node_shared']=='true' and config['node_shared_libuv']=='true'
    else:
        subprocess.run(['./configure','--shared','--shared-libuv','--shared-libuv-includes='+str(uv/'include'),'--shared-libuv-libpath='+str(uv/'lib')],cwd=root,check=True,timeout=60)
    child=subprocess.Popen(['make','-j'+str(a.jobs)],cwd=root,start_new_session=True)
    try:
        code=child.wait(timeout=a.deadline)
        if code: raise subprocess.CalledProcessError(code,child.args)
    except subprocess.TimeoutExpired:
        snapshot=subprocess.check_output(['ps','-axo','pid=,ppid='],text=True,timeout=5)
        rows=[tuple(map(int,line.split())) for line in snapshot.splitlines()]
        owned={child.pid};changed=True
        while changed:
            count=len(owned);owned.update(pid for pid,parent in rows if parent in owned);changed=len(owned)!=count
        for pid in sorted(owned,reverse=True):
            try: os.kill(pid,signal.SIGTERM)
            except ProcessLookupError: pass
        child.wait(timeout=10)
        raise
    a.state.write_text('done')
except Exception as error:
    a.state.write_text('failed: '+str(error))
    raise
