import type { IncomingMessage } from 'http';
import {Express} from 'express';
import type WebSocket from 'ws';

export interface PgConfig {
    user: string;
    host: string;
    database: string;
    password: string;
    port: number;
}

export interface ServerConfig {
    port?: number;
    pgConfig?: PgConfig;
}

export interface JWTPayload {
    email: string;
    name?: string;
    preferred_username?: string;
    sid?: string;
}

export interface UserInfo {
    email: string;
    name: string;
    sessionId?: string;
}

export interface Notification {
    channel: string;
    payload: any;
    timestamp: string;
}

export interface WebSocketMessage {
    type?: string;
    action?: string;
    data?: any;
    [key: string]: any;
}

export interface HealthResponse {
    status: 'ok' | 'error';
    connections: number;
    timestamp: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
    userEmail?: string;
    userName?: string;
    sessionId?: string;
}

export interface ServerInstance {
    app: Express.Application;
    server: import('http').Server;
    wss: import('ws').WebSocketServer;
    pgClient: import('pg').Client;
    connectDatabase: () => Promise<boolean>;
    validateToken: (token: string | null) => UserInfo;
    broadcastNotification: (notification: Notification) => number;
    handleWebSocketConnection: (ws: AuthenticatedWebSocket, req: IncomingMessage) => boolean;
    handleMessage: (ws: AuthenticatedWebSocket, message: string | Buffer) => WebSocketMessage | undefined;
    start: () => Promise<{ server: import('http').Server; wss: import('ws').WebSocketServer; pgClient: import('pg').Client }>;
    shutdown: () => Promise<void>;
}