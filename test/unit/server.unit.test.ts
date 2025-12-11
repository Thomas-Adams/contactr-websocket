import {describe, it, expect, jest, beforeEach} from '@jest/globals';
import jwt from 'jsonwebtoken';
import {createWebSocketServer} from '../../src/server';
import type {WebSocket} from 'ws';
import type {AuthenticatedWebSocket, Notification} from '../../src/types';

describe('WebSocket Server - Unit Tests', () => {

    describe('validateToken', () => {
        let wsServer: ReturnType<typeof createWebSocketServer>;

        beforeEach(() => {
            wsServer = createWebSocketServer();
        });

        it('should validate a valid token', () => {
            const token = jwt.sign(
                {
                    email: 'test@example.com',
                    name: 'Test User',
                    sid: 'session-123'
                },
                'secret'
            );

            const result = wsServer.validateToken(token);

            expect(result).toEqual({
                email: 'test@example.com',
                name: 'Test User',
                sessionId: 'session-123'
            });
        });

        it('should throw error for missing token', () => {
            expect(() => {
                wsServer.validateToken(null);
            }).toThrow('No token provided');
        });

        it('should throw error for invalid token payload', () => {
            const token = jwt.sign({sub: '123'}, 'secret');

            expect(() => {
                wsServer.validateToken(token);
            }).toThrow('Invalid token payload');
        });

        it('should handle token without name field', () => {
            const token = jwt.sign(
                {
                    email: 'test@example.com',
                    preferred_username: 'testuser'
                },
                'secret'
            );

            const result = wsServer.validateToken(token);

            expect(result.name).toBe('testuser');
        });
    });

    describe('broadcastNotification', () => {
        let wsServer: ReturnType<typeof createWebSocketServer>;
        let mockClients: Array<Partial<WebSocket>>;

        beforeEach(() => {
            wsServer = createWebSocketServer();

            // Mock WebSocket clients
            mockClients = [
                {
                    readyState: 1, // OPEN
                    send: jest.fn() as any
                },
                {
                    readyState: 1, // OPEN
                    send: jest.fn() as any
                },
                {
                    readyState: 0, // CONNECTING
                    send: jest.fn() as any
                }
            ];

            // Mock wss.clients
            wsServer.wss.clients = new Set(mockClients as unknown as Set<WebSocket>);
        });

        it('should broadcast to all open clients', () => {
            const notification: Notification = {
                channel: 'contact_changes',
                payload: {id: '123', action: 'update'},
                timestamp: new Date().toISOString()
            };

            const count = wsServer.broadcastNotification(notification);

            expect(count).toBe(2); // Only 2 clients with readyState === 1
            expect(mockClients[0].send).toHaveBeenCalledWith(
                JSON.stringify(notification)
            );
            expect(mockClients[1].send).toHaveBeenCalledWith(
                JSON.stringify(notification)
            );
            expect(mockClients[2].send).not.toHaveBeenCalled();
        });

        it('should return 0 when no clients are connected', () => {
            wsServer.wss.clients = new Set();

            const count = wsServer.broadcastNotification({
                channel: 'test',
                payload: {},
                timestamp: new Date().toISOString()
            });

            expect(count).toBe(0);
        });
    });

    describe('handleMessage', () => {
        let wsServer: ReturnType<typeof createWebSocketServer>;
        let mockWs: Partial<AuthenticatedWebSocket>;

        beforeEach(() => {
            wsServer = createWebSocketServer();
            mockWs = {
                userEmail: 'test@example.com',
                send: jest.fn() as any
            };
        });

        it('should handle ping message', () => {
            const message = JSON.stringify({type: 'ping'});

            wsServer.handleMessage(mockWs as AuthenticatedWebSocket, message);

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"pong"')
            );
        });

        it('should reject lock/unlock actions', () => {
            const message = JSON.stringify({action: 'lock', entityId: '123'});

            wsServer.handleMessage(mockWs as AuthenticatedWebSocket, message);

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('Please use PostgREST RPC endpoints')
            );
        });

        it('should handle invalid JSON', () => {
            const message = 'invalid json{';

            expect(() => {
                wsServer.handleMessage(mockWs as AuthenticatedWebSocket, message);
            }).toThrow();

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('Invalid message format')
            );
        });

        it('should parse and return valid message', () => {
            const messageData = {type: 'custom', data: 'test'};
            const message = JSON.stringify(messageData);

            const result = wsServer.handleMessage(mockWs as AuthenticatedWebSocket, message);

            expect(result).toEqual(messageData);
        });
    });

    describe('handleWebSocketConnection', () => {
        let wsServer: ReturnType<typeof createWebSocketServer>;
        let mockWs: Partial<AuthenticatedWebSocket>;
        let mockReq: Partial<import('http').IncomingMessage>;

        beforeEach(() => {
            wsServer = createWebSocketServer();
            mockWs = {
                send: jest.fn() as any,
                close: jest.fn() as any
            };
        });

        it('should accept valid token', () => {
            const token = jwt.sign(
                {email: 'test@example.com', name: 'Test'},
                'secret'
            );

            mockReq = {
                url: `/?token=${token}`,
                headers: {host: 'localhost:3011'}
            };

            const result = wsServer.handleWebSocketConnection(
                mockWs as AuthenticatedWebSocket,
                mockReq as import('http').IncomingMessage
            );

            expect(result).toBe(true);
            expect(mockWs.userEmail).toBe('test@example.com');
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('Connected to realtime notifications')
            );
        });

        it('should reject missing token', () => {
            mockReq = {
                url: '/',
                headers: {host: 'localhost:3011'}
            };

            const result = wsServer.handleWebSocketConnection(
                mockWs as AuthenticatedWebSocket,
                mockReq as import('http').IncomingMessage
            );

            expect(result).toBe(false);
            expect(mockWs.close).toHaveBeenCalledWith(1008, 'No token provided');
        });
    });
});