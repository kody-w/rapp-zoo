# Frontier architecture

RAPP Zoo follows the Frontier pattern as a reversible shell:

- `zoo.py` and its RAPP/1 filesystem state remain the source of truth.
- Electron supervises or adopts that loopback service; it never rewrites the
  Python runtime or exposes Node.js to the page.
- `desktop/preload.cjs` is the only renderer bridge. Its IPC surface is fixed,
  context-isolated, sandboxed, and origin-checked in the main process.
- Electron starts a second Grail Brainstem by reference on port `7072`, with a
  zoo-owned soul and the user's installed agent set plus the hologram foundry
  agents. GitHub Copilot uses the Brainstem's real tool loop; the Electron
  renderer never receives shell or filesystem primitives. Missing runtimes
  fail with installation guidance; the app never executes a mutable remote
  installer.
- The Brainstem `/chat` call and deterministic UI driver are separate: model
  intelligence can use tools, while ordinary navigation remains free and
  visible.
- The same responsive web UI remains installable as a mobile PWA. When the
  desktop host is reachable, mobile is its client rather than a second engine;
  this release does not add a pairing tunnel or run Brainstem on-device.
- Hologram DOGGs are data-only scene records. They execute only through the
  zoo-owned Three.js runtime. Electron uses the dedicated
  `hologram.localhost` origin; a remotely reached PWA uses a same-host iframe
  with `allow-same-origin` removed. Per-response CSP nonces load only the
  packaged renderer assets in that opaque mobile sandbox. Live state crosses
  the boundary through a closed `postMessage` contract and the child CSP
  forbids network connections.
- A DOGG is a caught bottle: stable memory, dimensions, identity, and polish.
  Each run supplies ephemeral `data_slosh`; the same tick can be viewed through
  many bottle lenses without changing the source frame.

Deleting `desktop/`, `package.json`, and the optional desktop UI affordance
returns the original local Flask application unchanged.
