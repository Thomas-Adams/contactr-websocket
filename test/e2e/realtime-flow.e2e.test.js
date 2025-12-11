import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createTestClient, waitForConnection, waitForMessage } from '../helpers.ts';
import pkg from 'pg';

const { Client } = pkg;

describe('End-to-End: Real-time Contact Updates', () => {
    let pgClient;
    let ws1, ws2;
    const TEST_PORT = 3011;

    beforeAll(async () => {
        pgClient = new Client({
            user: 'contactr',
            host: 'localhost',
            database: 'contactr_test',
            password: 'contactr',
            port: 15432,
        });

        await pgClient.connect();
    });

    afterAll(async () => {
        ws1?.close();
        ws2?.close();
        await pgClient.end();
    });

    it('should notify all clients when contact is updated', async () => {
        // Connect two clients
        ws1 = createTestClient(TEST_PORT, 'user1@example.com');
        ws2 = createTestClient(TEST_PORT, 'user2@example.com');

        await waitForConnection(ws1);
        await waitForConnection(ws2);

        // Listen for notifications
        const notification1Promise = waitForMessage(ws1, 'contact_changes');
        const notification2Promise = waitForMessage(ws2, 'contact_changes');

        // Trigger database update (simulated)
        const updatePayload = {
            id: '123',
            action: 'update',
            data: { name: 'John Doe', email: 'john@example.com' }
        };

        await pgClient.query(
            `NOTIFY contact_changes, '${JSON.stringify(updatePayload)}'`
        );

        // Both clients should receive notification
        const [notif1, notif2] = await Promise.all([
            notification1Promise,
            notification2Promise
        ]);

        expect(notif1.payload).toEqual(updatePayload);
        expect(notif2.payload).toEqual(updatePayload);
    });
});