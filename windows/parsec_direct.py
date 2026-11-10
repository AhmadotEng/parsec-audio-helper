import ctypes, hashlib, socket, struct, subprocess, sys, time, os
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
import frida

DIRECT_MAC = '192.168.2.1'
DIRECT_PC = '192.168.2.100'
SHORTCUT = r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Parsec\Parsec.lnk'

HOOK = r"""
const mac = '192.168.2.1', pc = [192,168,2,100], adapterIndex = ADAPTER_INDEX;
const ws = Process.getModuleByName('ws2_32.dll');
Interceptor.attach(ws.getExportByName('WSASendMsg'), {
  onEnter(args) {
    this.control = null;
    try {
      const message = args[1], name = message.readPointer();
      if (name.isNull()) return;
      const family = name.readU16(), offset = family === 23 ? 20 : family === 2 ? 4 : -1;
      if (offset < 0) return;
      const destination = [0,1,2,3].map(i => name.add(offset+i).readU8()).join('.');
      if (destination !== mac) return;
      const length = message.add(32).readU32(), c = message.add(40).readPointer();
      if (length < 24 || c.isNull() || c.add(8).readS32() !== 0 || c.add(12).readS32() !== 19) return;
      this.original = c.add(16).readByteArray(8);
      this.control = c;
      c.add(16).writeByteArray(pc);
      c.add(20).writeU32(adapterIndex);
    } catch (_) {}
  },
  onLeave() {
    if (this.control !== null && this.original) this.control.add(16).writeByteArray(this.original);
  }
});
send('ready');
"""

def find_host():
    command = "Get-CimInstance Win32_Process -Filter \"Name = 'parsecd.exe'\" | Where-Object { $_.CommandLine -match 'SERVICE_LAUNCHED' -and $_.CommandLine -notmatch 'LOADER_' } | Select-Object -First 1 -ExpandProperty ProcessId"
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    text = result.stdout.strip()
    return int(text) if text.isdecimal() else None

def adapter_index():
    command = ("Get-NetIPAddress -AddressFamily IPv4 -IPAddress '192.168.2.100' "
               "-ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' -and "
               "(Get-NetAdapter -InterfaceIndex $_.InterfaceIndex).Status -eq 'Up' } | "
               "Select-Object -First 1 -ExpandProperty InterfaceIndex")
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                            capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    text = result.stdout.strip()
    if not text.isdecimal():
        return None
    expected = int(text)
    index = ctypes.c_ulong()
    address = struct.unpack('<I', socket.inet_aton(DIRECT_MAC))[0]
    if ctypes.windll.iphlpapi.GetBestInterface(address, ctypes.byref(index)) or index.value != expected:
        return None
    return expected


VIDEO_HASH = 'dbd59739cfb84a239860a30480b91281f0ebd316dfb5bf58bd4539e82c92c425'
VIDEO_DLL = Path(r'C:\Program Files\Parsec\verified\parsecd-150-105c.dll')
VIDEO_HOOK = r"""
const mod=Process.enumerateModules().find(x=>x.name==='parsecd-150-105c.dll');
if(!mod || !mod.path.toLowerCase().endsWith('\\verified\\parsecd-150-105c.dll')) throw Error('Unsupported loaded Parsec library');
function hex8(addr){return Array.from(new Uint8Array(addr.readByteArray(8))).map(x=>x.toString(16).padStart(2,'0')).join('')}
if(hex8(mod.base.add(0xa7550))!=='48895c2408574883' || hex8(mod.base.add(0x45340))!=='48895c240848896c') throw Error('Parsec code does not match tested version');
const kernel=Process.getModuleByName('kernel32.dll');
const reason=Memory.alloc(4);reason.writeS32(0); const active=Memory.alloc(4), paused=Memory.alloc(4), deadline=Memory.alloc(8), owner=Memory.alloc(8); active.writeS32(1); paused.writeS32(0); deadline.writeU64(0); owner.writeU64(0);
const cm=new CModule(`
#include <gum/guminterceptor.h>
#include <stdint.h>
extern void Sleep(unsigned int);
extern unsigned long long GetTickCount64(void);
extern volatile int reason;
extern volatile int active;
extern volatile int paused;
extern volatile unsigned long long deadline;
extern volatile unsigned long long owner;
void on_control(GumInvocationContext *ic) {
  unsigned char *data=(unsigned char *)gum_invocation_context_get_nth_argument(ic,2);
  unsigned long long length=(unsigned long long)gum_invocation_context_get_nth_argument(ic,3);
  unsigned char *info=(unsigned char *)gum_invocation_context_get_nth_argument(ic,4);
  unsigned long long sock=(unsigned long long)gum_invocation_context_get_nth_argument(ic,0);
  unsigned int flags=(unsigned int)(uintptr_t)gum_invocation_context_get_nth_argument(ic,5);
  if(!active)return;
  if(paused && owner && owner!=sock){reason=2;paused=0;owner=0;active=0;return;}
  if((flags & 0x2000) || !data) { if(owner==sock){reason=1;paused=0;owner=0;} return; }
  if (length != 13 || !info) return;
  if (*(unsigned short *)info != 0 || *(unsigned int *)(info+8) != 0x35000000) return;
  for (int i=0;i<12;i++) if(data[i]) return;
  if (data[12]==19) {owner=sock; deadline=GetTickCount64()+5000; reason=19; paused=1;}
  else if(data[12]==13 && (!owner || owner==sock)) {reason=13;paused=0;owner=0;}
}

`,{Sleep:kernel.getExportByName('Sleep'),GetTickCount64:kernel.getExportByName('GetTickCount64'), active, paused, deadline, owner, reason});
Interceptor.attach(mod.base.add(0xa7550),cm.on_control);
const target=mod.base.add(0x45340);
const original=new NativeFunction(target,'int',['pointer','uint','pointer']);
const sleep=new NativeFunction(kernel.getExportByName('Sleep'),'void',['uint']); const ticks=new NativeFunction(kernel.getExportByName('GetTickCount64'),'uint64',[]);
const replacement=new NativeCallback(function(a,b,c){if(this.returnAddress.equals(mod.base.add(0xacbef))&&active.readS32()&&paused.readS32()){if(ticks().compare(deadline.readU64())>0){reason.writeS32(98);paused.writeS32(0);owner.writeU64(0);}else{sleep(20);return 10;}}return original(a,b,c)},'int',['pointer','uint','pointer']);
Interceptor.replace(target,replacement);
rpc.exports={heartbeat(){if(paused.readS32())deadline.writeU64(ticks().add(5000));return {paused:paused.readS32(), reason:reason.readS32()}}, status(){return paused.readS32()}, stop(){paused.writeS32(0);active.writeS32(0)}};
send('ready');
"""

def safe_detach(session, video):
    if not session or session.is_detached:
        return
    if video:
        try:
            video.exports_sync.stop()
            time.sleep(0.5)
        except Exception:
            pass
    try:
        session.detach()
    except Exception:
        pass

def main():
    kernel = ctypes.windll.kernel32
    kernel.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel.CreateMutexW(None, False, 'Local\\ParsecDirectHelper-Ahmad')
    if not handle:
        raise ctypes.WinError()
    if kernel.GetLastError() == 183:
        print('Parsec Direct Helper is already running. You may close this window.')
        time.sleep(4)
        return
    print('Parsec Direct Helper')
    print('Keep this window open. Closing it stops the helper.')
    print('Opening Parsec...')
    os.startfile(SHORTCUT)
    session = video = None
    while True:
        try:
            pid = find_host()
            if pid is None:
                print('Waiting for the Parsec host...')
                time.sleep(5)
                continue
            idx = adapter_index()
            session = frida.attach(pid)
            direct = None
            if idx is not None:
                direct = session.create_script(HOOK.replace('ADAPTER_INDEX', str(idx)))
                direct.load()
                print(f'Direct Ethernet helper active on adapter {idx}.')
            else:
                print('Direct Ethernet is unavailable; reconnect the cable and restart this helper.')
            video = None
            try:
                digest = hashlib.sha256(VIDEO_DLL.read_bytes()).hexdigest()
                if digest != VIDEO_HASH:
                    raise ValueError('Parsec version is not the version tested with video pause')
                video = session.create_script(VIDEO_HOOK)
                video.load()
                print('GPU video pause helper active.')
                print('If video was already paused, click Restore video then Pause video.')
            except Exception as exc:
                video = None
                print(f'GPU video pause unavailable: {exc}')
                print('Direct Ethernet remains available.')
            print(f'Connect from the Mac: {DIRECT_PC} <-> {DIRECT_MAC}.')
            last_pause = None
            while not session.is_detached:
                if video:
                    status = video.exports_sync.heartbeat()
                    state = bool(status['paused'])
                    if state != last_pause:
                        print('Video capture paused; audio continues.' if state else 'Video capture running.')
                        last_pause = state
                    if status.get('reason') == 2:
                        print('Multiple Parsec connections detected; GPU pause disabled for safety.')
                        video.exports_sync.stop()
                        video = None
                time.sleep(1)
            print('Parsec restarted. Reconnecting helper...')
            session = video = None
        except KeyboardInterrupt:
            safe_detach(session, video)
            print('Helper stopped.')
            return
        except Exception as exc:
            print(f'Waiting to attach: {exc}')
            safe_detach(session, video)
            session = video = None
            time.sleep(5)

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Could not start helper: {exc}')
        input('Press Enter to close...')
