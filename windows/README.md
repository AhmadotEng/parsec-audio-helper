# Experimental Windows host helper

This helper runs on the Windows Parsec host. The Chrome extension runs separately on the Mac.

## Requirements and start

- Windows x64, Python 3.11 x64 with pip, and the Parsec Windows app.
- The Chrome extension in this repository, loaded in Chrome on the Mac.
- For the direct-network feature: PC `192.168.2.100`, Mac `192.168.2.1`, and a directly connected Ethernet cable. Keep internet access for Parsec’s online services.
- GPU pause supports only the tested Parsec host library `parsecd-150-105c.dll` with SHA-256 `dbd59739cfb84a239860a30480b91281f0ebd316dfb5bf58bd4539e82c92c425`.

Extract the helper archive and double-click `Open Parsec Direct.cmd`. On first use it installs the pinned `frida==17.26.2` dependency from PyPI into this folder. Keep the window open. If attaching to Parsec is denied, close the helper and run the launcher as administrator.

Connect from the Mac. **Pause video** skips Parsec’s host capture call for the session; **Restore video** resumes it. If the extension was already paused when the helper started, click Restore video and then Pause video once. If the direct cable was disconnected when starting, reconnect it and restart the helper for direct routing.

## Scope and limitations

- This is experimental, unsupported runtime instrumentation. It injects Frida into the running Parsec host; it does not edit Parsec files. Closing the helper removes the instrumentation. Earlier prototypes caused host restarts; save work before testing.
- The exact host DLL hash and instruction bytes are checked; GPU pause is disabled for unsupported builds. Direct routing is independent.
- Tested with one Mac client. It is not designed for multiple guests. An observed second SCTP socket makes video pause fail open, but this is not complete multi-user support.
- A watchdog resumes capture if the helper heartbeat stops. The encoder session may remain allocated while connected.
- The hard-coded IP addresses match the original setup. Adapting it requires changing `DIRECT_MAC`, `DIRECT_PC`, and the corresponding JavaScript constants in `parsec_direct.py`.
- Parsec’s online service is still needed to connect. The extension may show Ethernet instead of Direct when Chrome hides candidate addresses.
- After restarting the PC, run the launcher again. It does not install itself into Windows startup.
