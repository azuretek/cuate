"""Stage a pinned, already-built Node24 shared tree as a scratch embedder prefix; never install."""
import argparse
from pathlib import Path
import json
import shutil
import subprocess
p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();root=a.source.resolve();out=a.output.resolve()
revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True,timeout=10).strip()
assert revision=='955266bfdd854cd280dffd47548673914484e4c0','wrong maintained24 source revision'
assert '#define NODE_MAJOR_VERSION 24' in (root/'src/node_version.h').read_text()
libs=list((root/'out/Release').glob('libnode.*.dylib'))
assert len(libs)==1,'shared build missing or ambiguous'
out.mkdir(parents=True,exist_ok=False)
headers=out/'include/node';headers.mkdir(parents=True)
for directory in [root/'src',root/'deps/v8/include',root/'deps/uv/include']:
    for file in directory.rglob('*.h'):
        dest=headers/file.relative_to(directory);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest)
(out/'lib').mkdir();shutil.copy2(libs[0],out/'lib'/libs[0].name)
(out/'source.json').write_text(json.dumps({'tag':'v24.21.0','revision':revision,'installed':False},indent=2))
print('NODE24_BUILD_ARTIFACTS_STAGED',libs[0].name)
