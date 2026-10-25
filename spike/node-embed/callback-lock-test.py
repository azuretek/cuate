"""Compile the actual callback bodies against a competing delivery-thread lock probe."""
import argparse
from pathlib import Path
import re
import subprocess
import tempfile
p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,default=Path(__file__).with_name('embed.cc'))
a=p.parse_args()
source=a.source.read_text()
bodies=chr(10).join(re.search(r'extern "C" void '+name+r'\([^\n]+\) \{.*?^\}',source,re.M|re.S).group(0) for name in ['native_complete','native_rpc_complete'])
harness=r'''
#include <mutex>
#include <vector>
#include <string>
#include <thread>
#include <cstdint>
#include <cassert>
struct Reply { int32_t id,pid,main_thread; std::string payload; int error=0; bool rpc=false; };
struct Runtime { std::mutex mutex; std::vector<Reply> replies; int async=0; };
Runtime state; Runtime* runtime=&state;
int unlocked_publications=0;
void uv_async_send(int*) {
  std::thread delivery([] { if(runtime->mutex.try_lock()) { ++unlocked_publications;runtime->mutex.unlock(); } });
  delivery.join();
}
'''+bodies+r'''
int main() { native_complete(1,2,1); native_rpc_complete(3,"synthetic",0); assert(state.replies.size()==2); assert(unlocked_publications==0); }
'''
with tempfile.TemporaryDirectory(prefix='native-callback-lock-') as tmp:
    cpp=Path(tmp)/'test.cc';exe=Path(tmp)/'test'
    cpp.write_text(harness)
    subprocess.run(['c++','-std=c++20','-pthread',str(cpp),'-o',str(exe)],check=True,timeout=20)
    subprocess.run([str(exe)],check=True,timeout=5)
print('CALLBACK_SEND_LOCK_INVARIANT_PASS')
