import net from 'node:net';
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

const main = async () => {
    const port = await getFreePort();
    const serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const shutdown = async () => {
        if (!serverProcess.killed) {
            serverProcess.kill('SIGTERM');
        }
        await wait(500);
    };

    try {
        let startupOutput = '';
        serverProcess.stdout.on('data', (chunk) => {
            startupOutput += String(chunk);
        });

        await waitFor(
            () => startupOutput.includes(`running at '127.0.0.1' on port ${port}`),
            5000,
            'Timed out waiting for websocket server startup',
        );

        const roomName = `smoke-${Date.now()}`;
        const documentA = new Y.Doc();
        const documentB = new Y.Doc();
        const providerA = new WebsocketProvider(`ws://127.0.0.1:${port}`, roomName, documentA, {
            WebSocketPolyfill: WebSocket,
            disableBc: true,
        });
        const providerB = new WebsocketProvider(`ws://127.0.0.1:${port}`, roomName, documentB, {
            WebSocketPolyfill: WebSocket,
            disableBc: true,
        });

        try {
            await Promise.all([
                waitForSync(providerA),
                waitForSync(providerB),
            ]);

            const sharedTextA = documentA.getText('content');
            const sharedTextB = documentB.getText('content');
            sharedTextA.insert(0, 'hello websocket');

            await waitFor(
                () => sharedTextB.toString() === 'hello websocket',
                5000,
                `Timed out waiting for replicated document update; saw: ${sharedTextB.toString()}`,
            );

            console.log('Websocket sync smoke test passed');
        } finally {
            providerA.destroy();
            providerB.destroy();
            documentA.destroy();
            documentB.destroy();
        }
    } finally {
        await shutdown();
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});