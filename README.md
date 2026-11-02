# Parsec Audio Helper

A Chrome Manifest V3 extension that adds a toolbar popup for the Parsec web client at `https://web.parsec.app`.

## Features

- Request that the connected host pause video while leaving audio handling unchanged.
- Restore normal video requests.
- Passively count received audio and video bytes where supported; audio content is not read.
- Optional microphone capture with input selection, mute, and stop controls.
- Microphone capture starts only after the user presses **Start mic** and grants Chrome permission.
- Controls appear in the extension toolbar popup, not as an overlay in the Parsec page.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the `extension` folder.
4. Reload `https://web.parsec.app`, connect to a host, then open the extension from the toolbar.

## Notes

This is an experimental helper that relies on the current public Parsec web client interface and packet behavior. Parsec updates may break compatibility. The video control requests a pause; it does not guarantee that host encoding or network traffic has stopped. Microphone frames being sent do not confirm that the host receives or uses them. The helper provides no microphone return audio and changes no host configuration.

The extension requests access only to `https://web.parsec.app/*`. It does not store credentials, session data, or microphone audio.
