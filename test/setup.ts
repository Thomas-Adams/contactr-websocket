import { jest } from '@jest/globals';

// Global test setup
jest.setTimeout(10000);

// Suppress console logs during tests (optional)
if (process.env.SILENT_TESTS === 'true') {
    global.console = {
        ...console,
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    } as any;
}