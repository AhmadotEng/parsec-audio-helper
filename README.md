# Parsec Audio Helper

A Chrome Manifest V3 extension that adds a toolbar popup for the Parsec web client at `https://web.parsec.app`.

## Features

- Request that the connected host pause video while leaving audio handling unchanged.
- Restore normal video requests.
- Passively count received audio and video bytes where supported; audio content is not read.
- Optional microphone capture with input selection, mute, and stop controls.
- Microphone capture starts only after the user presses **Start mic** and grants Chrome permission.
- Display the selected WebRTC route as Wi-Fi, Ethernet, Direct, or unknown when Chrome provides the necessary information.
- Open the toolbar popup when a Parsec connection is detected in the active tab, and restore the helper after the extension is reloaded.
- Controls appear in the extension toolbar popup, not as an overlay in the Parsec page.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the `extension` folder.
4. Reload `https://web.parsec.app`, connect to a host, then open the extension from the toolbar.

## Connection status

The connection label describes the route selected by WebRTC; it does not force a particular interface. Chrome may hide candidate addresses or interface details, in which case the label can show Ethernet or an unknown route. The Direct label currently recognizes only the configured address pair `192.168.2.1` and `192.168.2.100`; other direct networks may display Ethernet or unknown. The Windows-side direct-link helper is separate and is not included in this extension.

## Notes

This is an experimental helper that relies on the current public Parsec web client interface and packet behavior. Parsec updates may break compatibility. The video control requests a pause; it does not guarantee that host encoding or network traffic has stopped. Microphone frames being sent do not confirm that the host receives or uses them. The helper provides no microphone return audio and changes no host configuration.

The extension requests site access only to `https://web.parsec.app/*` and uses the `activeTab` and `scripting` permissions to restore its helper in open Parsec tabs. It does not store credentials, session data, or microphone audio.
