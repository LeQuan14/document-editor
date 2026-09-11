import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

const port = Number.parseInt(process.env.PORT ?? '1234', 10);
const host = process.env.HOST ?? 'localhost';
const defaultDatabasePath = fileURLToPath(new URL('./data/document-editor.sqlite', import.meta.url));
const databasePath = process.env.SQLITE_PATH ?? defaultDatabasePath;

mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
CREATE TABLE IF NOT EXISTS documents (
  name TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  updated_at INTEGER NOT NULL
)
`);

const selectDocumentState = database.prepare('SELECT state FROM documents WHERE name = ?');
const upsertDocumentState = database.prepare(`
  INSERT INTO documents (name, state, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    state = excluded.state,
    updated_at = excluded.updated_at
`);

const docs = new Map();
const messageSync = 0;
const messageAwareness = 1;

const persistDocument = (doc) => {
	const state = Y.encodeStateAsUpdate(doc);
	upsertDocumentState.run(doc.name, Buffer.from(state), Date.now());
};

const loadDocumentState = (doc) => {
	const row = selectDocumentState.get(doc.name);
	if (row?.state != null) {
		Y.applyUpdate(doc, new Uint8Array(row.state));
	}
};

class SharedDoc extends Y.Doc {
	constructor(name) {
		super({ gc: true });
		this.name = name;
		this.conns = new Map();
		this.awareness = new awarenessProtocol.Awareness(this);
		this.awareness.setLocalState(null);

		this.awareness.on('update', ({ added, updated, removed }, conn) => {
			const changedClients = added.concat(updated, removed);
			if (conn !== null) {
				const connControlledIds = this.conns.get(conn);
				if (connControlledIds !== undefined) {
					added.forEach((clientId) => connControlledIds.add(clientId));
					removed.forEach((clientId) => connControlledIds.delete(clientId));
				}
			}

			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, messageAwareness);
			encoding.writeVarUint8Array(
				encoder,
				awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
			);
			const message = encoding.toUint8Array(encoder);
			this.conns.forEach((_controlledIds, connection) => {
				send(this, connection, message);
			});
		});

		this.on('update', (update) => {
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, messageSync);
			syncProtocol.writeUpdate(encoder, update);
			const message = encoding.toUint8Array(encoder);
			this.conns.forEach((_controlledIds, connection) => {
				send(this, connection, message);
			});

			persistDocument(this);
		});
	}
}

const getYDoc = (docName) => map.setIfUndefined(docs, docName, () => {
	const doc = new SharedDoc(docName);
	loadDocumentState(doc);
	docs.set(docName, doc);
	return doc;
});

const send = (doc, conn, message) => {
	if (conn.readyState !== WebSocket.OPEN && conn.readyState !== WebSocket.CONNECTING) {
		closeConn(doc, conn);
		return;
	}

	try {
		conn.send(message, {}, (err) => {
			if (err != null) {
				closeConn(doc, conn);
			}
		});
	} catch {
		closeConn(doc, conn);
	}
};

const closeConn = (doc, conn) => {
	if (!doc.conns.has(conn)) {
		return;
	}

	const controlledIds = doc.conns.get(conn);
	doc.conns.delete(conn);
	awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds ?? []), null);

	if (doc.conns.size === 0) {
		doc.destroy();
		docs.delete(doc.name);
	}

	conn.close();
};

const messageListener = (conn, doc, message) => {
	try {
		const encoder = encoding.createEncoder();
		const decoder = decoding.createDecoder(message);
		const messageType = decoding.readVarUint(decoder);

		switch (messageType) {
			case messageSync:
				encoding.writeVarUint(encoder, messageSync);
				syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
				if (encoding.length(encoder) > 1) {
					send(doc, conn, encoding.toUint8Array(encoder));
				}
				break;
			case messageAwareness:
				awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
				break;
			default:
				break;
		}
	} catch (error) {
		console.error(error);
		doc.emit('error', [error]);
	}
};

const setupWSConnection = (conn, req) => {
	const docName = (req.url ?? '').slice(1).split('?')[0];
	const doc = getYDoc(docName);

	conn.binaryType = 'arraybuffer';
	doc.conns.set(conn, new Set());
	conn.on('message', (message) => messageListener(conn, doc, new Uint8Array(message)));

	let pongReceived = true;
	const pingInterval = setInterval(() => {
		if (!pongReceived) {
			if (doc.conns.has(conn)) {
				closeConn(doc, conn);
			}
			clearInterval(pingInterval);
			return;
		}

		if (doc.conns.has(conn)) {
			pongReceived = false;
			try {
				conn.ping();
			} catch {
				closeConn(doc, conn);
				clearInterval(pingInterval);
			}
		}
	}, 30000);

	conn.on('close', () => {
		closeConn(doc, conn);
		clearInterval(pingInterval);
	});

	conn.on('pong', () => {
		pongReceived = true;
	});

	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, messageSync);
	syncProtocol.writeSyncStep1(encoder, doc);
	send(doc, conn, encoding.toUint8Array(encoder));

	const awarenessStates = doc.awareness.getStates();
	if (awarenessStates.size > 0) {
		const awarenessEncoder = encoding.createEncoder();
		encoding.writeVarUint(awarenessEncoder, messageAwareness);
		encoding.writeVarUint8Array(
			awarenessEncoder,
			awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
		);
		send(doc, conn, encoding.toUint8Array(awarenessEncoder));
	}
};

const server = http.createServer((_request, response) => {
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('okay');
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', setupWSConnection);

server.on('upgrade', (request, socket, head) => {
	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request);
	});
});

server.listen(port, host, () => {
	console.log(`running at '${host}' on port ${port}`);
});

process.on('exit', () => {
	database.close();
});