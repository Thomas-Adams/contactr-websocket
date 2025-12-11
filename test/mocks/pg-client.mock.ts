import {EventEmitter} from 'events';
import type pkg from 'pg';

/**
 * Mock PostgreSQL client for unit tests
 */
export class MockPgClient extends EventEmitter {
    public connected: boolean = false;
    public queries: string[] = [];

    async connect(): Promise<void> {
        this.connected = true;
    }

    async query(sql: string): Promise<pkg.QueryResult<any>> {
        this.queries.push(sql);
        return {
            rows: [],
            command: '',
            rowCount: 0,
            oid: 0,
            fields: []
        };
    }

    async end(): Promise<void> {
        this.connected = false;
    }

// Test helper: trigger notification
    triggerNotification(channel: string, payload: any): void {
        this.emit('notification', {
            channel,
            payload: JSON.stringify(payload)
        });
    }
}