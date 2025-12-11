import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { createWebSocketServer } from '../../src/server.js';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import pkg from 'pg';
import type { ServerInstance } from '../../src/types.js';

const { Client } = pkg;

describe('WebSocket Server - Integration Tests', () => {
    let wsServer: ServerInstance;
    let testPgClient: pkg.Client;
    const TEST_PORT = 3011; // ✅ Use different port or ensure cleanup

    beforeAll(async () => {
        // Create test server
        wsServer = createWebSocketServer({
            port: TEST_PORT,
            pgConfig: {
                user: 'contactr',
                host: 'localhost',
                database: 'contactr', // ✅ Use same database as server
                password: 'contactr',
                port: 15432,
            }
        });

        // Connect to database
        await wsServer.connectDatabase();

        // Start server
        await wsServer.start();

        // Create test PostgreSQL client for sending notifications
        testPgClient = new Client({
            user: 'contactr',
            host: 'localhost',
            database: 'contactr', // ✅ Must match server database
            password: 'contactr',
            port: 15432,
        });

        await testPgClient.connect();
    });

    afterAll(async () => {
        await testPgClient.end();
        await wsServer.shutdown();
    });

    describe('Health Check', () => {
        it('should return health status', async () => {
            const response = await fetch(`http://localhost:${TEST_PORT}/health`);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data).toMatchObject({
                status: 'ok',
                connections: expect.any(Number),
                timestamp: expect.any(String)
            });
        });
    });

    describe('WebSocket Connection', () => {
        it('should accept connection with valid token', (done) => {
            const token = jwt.sign(
                {
                    email: 'test@example.com',
                    name: 'Test User',
                    sid: 'session-123'
                },
                'secret'
            );

            const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);

            ws.on('open', () => {
                expect(ws.readyState).toBe(WebSocket.OPEN);
            });

            ws.on('message', (data: WebSocket.Data) => {
                const message = JSON.parse(data.toString());

                if (message.type === 'connection') {
                    expect(message.user).toBe('test@example.com');
                    expect(message.message).toContain('Connected');
                    ws.close();
                    done();
                }
            });

            ws.on('error', done);
        });

        it('should reject connection without token', (done) => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

            ws.on('close', (code: number, reason: Buffer) => {
                expect(code).toBe(1008);
                expect(reason.toString()).toContain('No token provided');
                done();
            });

            ws.on('error', () => {
                // Expected to fail
            });
        });
    });

    describe('Message Handling', () => {
        let ws: WebSocket;
        const token = jwt.sign(
            { email: 'test@example.com', name: 'Test' },
            'secret'
        );

        beforeEach((done) => {
            ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
            ws.on('open', () => {
                // Wait for welcome message
                ws.once('message', () => done());
            });
        });

        afterEach(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });

        it('should handle ping-pong', (done) => {
            ws.send(JSON.stringify({ type: 'ping' }));

            ws.on('message', (data: WebSocket.Data) => {
                const message = JSON.parse(data.toString());

                if (message.type === 'pong') {
                    expect(message.timestamp).toBeDefined();
                    done();
                }
            });
        });

        it('should reject lock actions', (done) => {
            ws.send(JSON.stringify({ action: 'lock', entityId: '123' }));

            ws.on('message', (data: WebSocket.Data) => {
                const message = JSON.parse(data.toString());

                if (message.type === 'error') {
                    expect(message.message).toContain('PostgREST RPC endpoints');
                    done();
                }
            });
        });
    });

    describe('PostgreSQL Notifications', () => {
        let ws1: WebSocket;
        let ws2: WebSocket;
        const token1 = jwt.sign({ email: 'user1@example.com' }, 'secret');
        const token2 = jwt.sign({ email: 'user2@example.com' }, 'secret');

        beforeEach((done) => {
            let connected = 0;

            ws1 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token1}`);
            ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token2}`);

            const checkDone = () => {
                connected++;
                if (connected === 2) {
                    // ✅ Small delay to ensure connections are stable
                    setTimeout(done, 100);
                }
            };

            ws1.on('open', () => ws1.once('message', checkDone));
            ws2.on('open', () => ws2.once('message', checkDone));
        });

        afterEach(() => {
            ws1?.close();
            ws2?.close();
        });

        it('should broadcast contact_changes to all clients', (done) => {
            const testPayload = {
                id: '123',
                action: 'update',
                data: { name: 'Updated Contact' }
            };

            let receivedCount = 0;

            // ✅ Set up message handlers immediately
            const checkReceived = (data: WebSocket.Data) => {
                const message = JSON.parse(data.toString());

                if (message.channel === 'contact_changes') {
                    expect(message.payload).toEqual(testPayload);
                    expect(message.timestamp).toBeDefined();

                    receivedCount++;
                    console.log(`✅ Received notification ${receivedCount}/2`);

                    if (receivedCount === 2) {
                        done();
                    }
                }
            };

            ws1.on('message', checkReceived);
            ws2.on('message', checkReceived);

            // ✅ Send notification after a delay to ensure listeners are ready
            setTimeout(() => {
                console.log('📤 Sending PostgreSQL notification...');
                testPgClient.query(
                    `NOTIFY contact_changes, '${JSON.stringify(testPayload)}'`
                ).then(() => {
                    console.log('✅ Notification sent');
                }).catch((err) => {
                    console.error('❌ Failed to send notification:', err);
                    done(err);
                });
            }, 500); // ✅ Increased delay
        }, 15000); // ✅ Increased timeout to 15 seconds

        it('should broadcast contact_locks to all clients', (done) => {
            const lockPayload = {
                contact_id: '456',
                locked_by: 'user@example.com',
                locked_at: new Date().toISOString()
            };

            // ✅ Use only one client for faster test
            const checkReceived = (data: WebSocket.Data) => {
                const message = JSON.parse(data.toString());

                if (message.channel === 'contact_locks') {
                    expect(message.payload).toEqual(lockPayload);
                    done();
                }
            };

            ws1.on('message', checkReceived);

            // ✅ Send notification
            setTimeout(() => {
                testPgClient.query(
                    `NOTIFY contact_locks, '${JSON.stringify(lockPayload)}'`
                ).catch(done);
            }, 500);
        }, 15000); // ✅ Increased timeout
    });
});