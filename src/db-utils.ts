import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DB_ROOT_DIR = process.env.DB_ROOT_DIR || './data';

/**
 * Ensures the database root directory exists
 */
async function ensureDbRootDir() {
    if (!existsSync(DB_ROOT_DIR)) {
        await mkdir(DB_ROOT_DIR, { recursive: true });
        console.log(`Created database directory: ${DB_ROOT_DIR}`);
    }
}

/**
 * Gets the full path for a database file
 * @param filename - The database filename (e.g., 'db_telegram.json')
 * @returns Full path to the database file
 */
export function getDbPath(filename: string): string {
    return join(DB_ROOT_DIR, filename);
}

/**
 * Initializes database directory - call this once at app startup
 */
export async function initializeDbDirectory() {
    await ensureDbRootDir();
}

export { DB_ROOT_DIR };