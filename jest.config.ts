import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: 'tsconfig.test.json'
            }
        ]
    },
    testMatch: [
        '**/tests/**/*.test.ts',
        '**/?(*.)+(spec|test).ts'
    ],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!**/node_modules/**'
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70
        }
    },
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    testTimeout: 10000,
    moduleFileExtensions: ['ts', 'js', 'json'],
    roots: ['<rootDir>/src', '<rootDir>/test']
};

export default config;