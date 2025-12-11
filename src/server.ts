import express, {type Express, type Request, type Response} from 'express';
import {createServer, type Server} from 'http';
import {WebSocketServer, type WebSocket, WebSocket as WS} from 'ws';
import {Meilisearch} from 'meilisearch';
import type {IncomingMessage} from 'http';
import pkg from 'pg';
import jwt from 'jsonwebtoken';
import type {
    ServerConfig,
    PgConfig,
    UserInfo,
    Notification,
    WebSocketMessage,
    HealthResponse,
    AuthenticatedWebSocket,
    ServerInstance,
    JWTPayload
} from './types.js';

const {Client} = pkg;

const meiliClient = new Meilisearch({
    host: 'http://127.0.0.1:7700',
    apiKey: 'master',
});


const contactsIndex = meiliClient.index('contacts');

// ===================================================================
// Sync function
// ===================================================================
async function syncToMeili(operation: any, data: any) {
    try {
        console.log(`📤 Syncing ${operation}:`, data.id || 'unknown');

        switch (operation) {
            case 'INSERT':
            case 'UPDATE':
                // Add or update document in MeiliSearch
                await contactsIndex.addDocuments([{
                    id: data.id,
                    given_name: data.given_name,
                    sur_name: data.sur_name,
                    email: data.email,
                    phone: data.phone,
                    mobile: data.mobile,
                    salutation: data.salutation,
                    gender: data.gender,
                    birth_date: data.birth_date,
                    created: data.created,
                    modified: data.modified
                }]);
                console.log(`✅ ${operation} synced to MeiliSearch`);
                break;

            case 'DELETE':
                // Delete document from MeiliSearch
                await contactsIndex.deleteDocument(data.id);
                console.log(`✅ DELETE synced to MeiliSearch`);
                break;

            default:
                console.warn(`⚠️ Unknown operation: ${operation}`);
        }
    } catch (error) {
        console.error(`❌ Failed to sync to MeiliSearch:`, error);
    }
}


// ===================================================================
// Create WebSocket Server Factory
// ===================================================================
export function createWebSocketServer(config: ServerConfig = {}): ServerInstance {
    const {
        port = 3011,
        pgConfig = {
            user: 'contactr',
            host: 'localhost',
            database: 'contactr',
            password: 'contactr',
            port: 15432,
        }
    } = config;

    const app: Express = express();
    const server: Server = createServer(app);
    const wss = new WebSocketServer({server});

    // PostgreSQL client setup
    const pgClient = new Client(pgConfig);

    // ===================================================================
    // Database Connection
    // ===================================================================
    async function connectDatabase(): Promise<boolean> {
        try {
            await pgClient.connect();
            console.log('✅ Connected to PostgreSQL database');

            // ✅ Add result checking
            const listenResult1 = await pgClient.query('LISTEN contact_changes');
            console.log('✅ LISTEN contact_changes result:', listenResult1);

            const listenResult2 = await pgClient.query('LISTEN contact_locks');
            console.log('✅ LISTEN contact_locks result:', listenResult2);

            // ✅ Verify we're listening
            const channels = await pgClient.query(`
            SELECT * FROM pg_listening_channels();
        `);
            console.log('📻 Currently listening to channels:', channels.rows);

            return true;
        } catch (err) {
            console.error('❌ Database connection error:', err);
            throw err;
        }
    }

    // ===================================================================
    // JWT Validation
    // ===================================================================
    function validateToken(token: string | null): UserInfo {
        if (!token) {
            throw new Error('No token provided');
        }

        const decoded = jwt.decode(token) as JWTPayload | null;

        if (!decoded || !decoded.email) {
            throw new Error('Invalid token payload');
        }

        return {
            email: decoded.email,
            name: decoded.name || decoded.preferred_username || 'Unknown',
            sessionId: decoded.sid
        };
    }

    // ===================================================================
    // Broadcast Notification
    // ===================================================================
    function broadcastNotification(notification: Notification): number {
        let broadcastCount = 0;

        wss.clients.forEach((client: WebSocket) => {
            if (client.readyState === WS.OPEN) {
                client.send(JSON.stringify(notification));
                broadcastCount++;
            }
        });

        return broadcastCount;
    }

    // ===================================================================
    // Handle PostgreSQL Notifications
    // ===================================================================
    pgClient.on('notification', (msg) => {
        console.log('📢 PostgreSQL notification message:', msg);
        console.log('📢 PostgreSQL notification:', msg.channel);
        console.log('   Payload:', msg.payload);

        const notification: Notification = {
            channel: msg.channel,
            payload: msg.payload ? JSON.parse(msg.payload) : null,
            timestamp: new Date().toISOString()
        };
        console.log("Notification is:", msg.payload);
        console.log("Notification is:", notification);
        console.log("Channel is:", msg.channel);
        if (msg.channel === 'contact_changes') {
            const payload = notification.payload;
            const operation = payload.operation;
            const data = payload.data;
            syncToMeili(payload.action, data).then(
                () => {
                    console.log(`   ✅ Synced to MeiliSearch ${JSON.stringify(payload.data)}`);
                }
            ).catch(
                (err) => {
                    console.error('   ❌ Sync to MeiliSearch failed:', err);
                }
            );
        }

        const count = broadcastNotification(notification);
        console.log(`   📤 Broadcasted to ${count} client(s)`);
    });

    // Error handling for PostgreSQL client
    pgClient.on('error', (err) => {
        console.error('❌ PostgreSQL client error:', err);
    });

    // ===================================================================
    // WebSocket Connection Handler
    // ===================================================================
    function handleWebSocketConnection(
        ws: AuthenticatedWebSocket,
        req: IncomingMessage
    ): boolean {
        try {
            // Extract JWT from query parameter
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const token = url.searchParams.get('token');

            const user = validateToken(token);

            ws.userEmail = user.email;
            ws.userName = user.name;
            ws.sessionId = user.sessionId;

            console.log('✅ Client connected:', user);

            // Send welcome message
            ws.send(JSON.stringify({
                type: 'connection',
                message: 'Connected to realtime notifications',
                user: ws.userEmail,
                timestamp: new Date().toISOString()
            }));

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
            console.error('❌ Authentication failed:', errorMessage);
            ws.close(1008, errorMessage);
            return false;
        }
    }

    // ===================================================================
    // Message Handler
    // ===================================================================
    function handleMessage(
        ws: AuthenticatedWebSocket,
        message: string | Buffer
    ): WebSocketMessage | undefined {
        try {
            const data: WebSocketMessage = JSON.parse(message.toString());
            console.log('📨 Received from', ws.userEmail, ':', data);

            // Handle lock/unlock actions
            if (data.action === 'lock' || data.action === 'unlock') {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Please use PostgREST RPC endpoints for lock/unlock operations',
                    hint: 'POST /rpc/lock_contact or /rpc/unlock_contact'
                }));
                return undefined;
            }

            // Handle ping
            if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
                return data;
            }

            return data;
        } catch (error) {
            console.error('❌ Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
            throw error;
        }
    }

    // ===================================================================
    // WebSocket Server Setup
    // ===================================================================
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const authenticatedWs = ws as AuthenticatedWebSocket;
        const authenticated = handleWebSocketConnection(authenticatedWs, req);

        if (!authenticated) return;

        authenticatedWs.on('message', (message: string | Buffer) => {
            handleMessage(authenticatedWs, message);
        });

        authenticatedWs.on('close', () => {
            console.log('❌ Client disconnected:', authenticatedWs.userEmail);
        });

        authenticatedWs.on('error', (error) => {
            console.error('❌ WebSocket error for', authenticatedWs.userEmail, ':', error);
        });
    });

    // ===================================================================
    // Health Check Endpoint
    // ===================================================================
    app.get('/health', (req: Request, res: Response<HealthResponse>) => {
        res.json({
            status: 'ok',
            connections: wss.clients.size,
            timestamp: new Date().toISOString()
        });
    });

    // ===================================================================
    // Graceful Shutdown
    // ===================================================================
    async function shutdown(): Promise<void> {
        console.log('👋 Shutting down server...');

        wss.clients.forEach((client) => {
            client.close(1001, 'Server shutting down');
        });

        await pgClient.end();

        return new Promise((resolve) => {
            server.close(() => {
                console.log('✅ Server closed');
                resolve();
            });
        });
    }

    // ===================================================================
    // Start Server
    // ===================================================================
    function start(): Promise<{ server: Server; wss: WebSocketServer; pgClient: pkg.Client }> {
        return new Promise((resolve) => {
            server.listen(port, () => {
                console.log(`🚀 WebSocket server running on ws://localhost:${port}`);
                console.log(`📊 Health check available at http://localhost:${port}/health`);
                resolve({server, wss, pgClient});
            });
        });
    }

    // ===================================================================
    // Exported API
    // ===================================================================
    return {
        app,
        server,
        wss,
        pgClient,
        connectDatabase,
        validateToken,
        broadcastNotification,
        handleWebSocketConnection,
        handleMessage,
        start,
        shutdown
    };
}

// ===================================================================
// Main Entry Point
// ===================================================================
if (import.meta.url === `file://${process.argv[1]}`) {
    const wsServer = createWebSocketServer();

    wsServer.connectDatabase()
        .then(() => wsServer.start())
        .catch((err) => {
            console.error('❌ Failed to start server:', err);
            process.exit(1);
        });

    process.on('SIGTERM', async () => {
        await wsServer.shutdown();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        await wsServer.shutdown();
        process.exit(0);
    });
}