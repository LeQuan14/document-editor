import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (check, timeoutMilliseconds, failureMessage) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMilliseconds) {
        if (check()) {
            return;
        }

        await wait(50);
    }

    throw new Error(failureMessage);
};

const getFreePort = async () => {
    const server = net.createServer();

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (typeof address !== 'object' || address === null) {
        server.close();
        throw new Error('Unable to determine a free port');
    }

    const { port } = address;
    await new Promise((resolve) => server.close(resolve));
    return port;
};

const waitForSync = async (provider, timeoutMilliseconds = 5000) => {
    await waitFor(() => provider.synced, timeoutMilliseconds, 'Timed out waiting for provider sync');
};

const startServer = (port, sqlitePath) => spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        SQLITE_PATH: sqlitePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForServerStartup = async (serverProcess, port) => {
    let startupOutput = '';

    serverProcess.stdout.on('data', (chunk) => {
        startupOutput += String(chunk);
    });

    await waitFor(
        () => startupOutput.includes(`running at '127.0.0.1' on port ${port}`),
        5000,
        'Timed out waiting for websocket server startup',
    );
};

const shutdownServer = async (serverProcess) => {
    if (!serverProcess.killed) {
        serverProcess.kill('SIGTERM');
    }

    await wait(500);
};

const connectProvider = (url, roomName, doc) => new WebsocketProvider(url, roomName, doc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
});

const main = async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-editor-persistence-'));
    const sqlitePath = path.join(tempDirectory, 'documents.sqlite');
    const port = await getFreePort();
    const roomName = `persistence-${Date.now()}`;
    const serverUrl = `ws://127.0.0.1:${port}`;

    try {
        let serverProcess = startServer(port, sqlitePath);

        try {
            await waitForServerStartup(serverProcess, port);

            const firstDoc = new Y.Doc();
            const firstProvider = connectProvider(serverUrl, roomName, firstDoc);

            try {
                await waitForSync(firstProvider);
                firstDoc.getText('content').insert(0, 'persisted text');
                await wait(150);
            } finally {
                firstProvider.destroy();
                firstDoc.destroy();
            }
        } finally {
            await shutdownServer(serverProcess);
        }

        serverProcess = startServer(port, sqlitePath);

        try {
            await waitForServerStartup(serverProcess, port);

            const secondDoc = new Y.Doc();
            const secondProvider = connectProvider(serverUrl, roomName, secondDoc);

            try {
                await waitForSync(secondProvider);
                await waitFor(
                    () => secondDoc.getText('content').toString() === 'persisted text',
                    5000,
                    `Timed out waiting for persisted text; saw: ${secondDoc.getText('content').toString()}`,
                );

                console.log('Websocket persistence smoke test passed');
            } finally {
                secondProvider.destroy();
                secondDoc.destroy();
            }
        } finally {
            await shutdownServer(serverProcess);
        }
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});