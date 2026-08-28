# Frontier architecture

RAPP Zoo follows the Frontier pattern as a reversible shell:

- `zoo.py` and its RAPP/1 filesystem state remain the source of truth.
- Electron supervises or adopts that loopback service; it never rewrites the
  Python runtime or exposes Node.js to the page.
- `desktop/preload.cjs` is the only renderer bridge. Its IPC surface is fixed,
  context-isolated, sandboxed, and origin-checked in the main process.
- Copilot CLI runs only in the Electron main process from an empty private
  working directory. It receives a bounded, path-free semantic snapshot and an
  explicitly empty tool inventory. Its output advises the user; visible UI
  controls remain the actuators.
- The Copilot IPC bridge is enabled only for the exact zoo process Electron
  launched and challenge-verified. Adopting an already-running loopback zoo
  leaves intelligence disabled rather than trusting a port number.
- The same responsive web UI remains installable as a mobile PWA. Copilot CLI
  intelligence is hosted by the desktop process because mobile operating
  systems cannot run the local CLI.

Deleting `desktop/`, `package.json`, and the optional desktop UI affordance
returns the original local Flask application unchanged.
