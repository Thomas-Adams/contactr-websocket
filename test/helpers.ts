import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

export interface TestClientOptions {
    name?: string;
    sessionId?: string;
}

/**
 * Create a test WebSocket client with authentication
 */
export function createTestClient(
    port: number,
    email: string = 'test@example.com',
    options: TestClientOptions = {}
): WebSocket {
    const token = jwt.sign(
        {
            email,
            name: options.name || 'Test User',
            sid: options.sessionId || 'test-session'
        },
        'secret'
    );

    return new WebSocket(`ws://localhost:${port}?token=${token}`);
}

/**
 * Wait for WebSocket to connect and receive welcome message
 */
export function waitForConnection(ws: WebSocket): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
        }, 5000);

        ws.on('open', () => {
            ws.once('message', (data: WebSocket.Data) => {
                clearTimeout(timeout);
                resolve(JSON.parse(data.toString()));
            });
        });

        ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

/**
 * Wait for specific message type
 */
export function waitForMessage(
    ws: WebSocket,
    messageType: string,
    timeout: number = 5000
): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for message: ${messageType}`));
        }, timeout);

        const handler = (data: WebSocket.Data) => {
            const message = JSON.parse(data.toString());

            if (message.type === messageType || message.channel === messageType) {
                clearTimeout(timer);
                ws.off('message', handler);
                resolve(message);
            }
        };

        ws.on('message', handler);
    });
}

/**
 * Send message and wait for response
 */
export async function sendAndWaitForResponse(
    ws: WebSocket,
    message: any,
    expectedType: string
): Promise<any> {
    const responsePromise = waitForMessage(ws, expectedType);
    ws.send(JSON.stringify(message));
    return responsePromise;
}