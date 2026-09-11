# Document Editor

A local first (hopefully) collaborative text editor.

### Tech Stack
- Frontend:
    - React
- Editor-Core:
    - Tiptap
- CRDT-Engine:
    - Yjs
- Local storage:
    - y-indexeddb
- Sync-Server:
    - y-websocket (Jode.js)
- Persistence:
    - SQLite

### Run locally

Start the websocket server in one terminal:

```sh
npm run server
```

Run the websocket smoke test without the browser:

```sh
npm run test:sync
```

Run the SQLite persistence smoke test:

```sh
npm run test:persistence
```

Start the frontend in another terminal:

```sh
npm run dev
```

The frontend connects to `ws://localhost:1234` by default. Set `VITE_YJS_WS_URL` if you want to point it at a different server.

### SQLite persistence

The websocket server stores each room's Yjs document state in a local SQLite file. That lets the server load the last saved document content back into memory after a restart, so the editor keeps its data instead of starting from an empty room every time.

----

CRDT = Conflict-free Replicated Data Types