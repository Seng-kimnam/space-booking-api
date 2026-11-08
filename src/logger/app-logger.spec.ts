import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppLogger } from './app-logger';

// WriteStream writes asynchronously; wait for pending writes to land.
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

const readLines = (file: string): Record<string, unknown>[] =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('AppLogger', () => {
  let dir: string;
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-logger-'));
    stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes JSON lines to the file, creating missing folders', async () => {
    const file = join(dir, 'nested', 'app.log');
    const logger = new AppLogger({ file });

    logger.log('hello', 'Bootstrap');
    logger.warn('careful', 'Bookings');
    await flush();

    const [first, second] = readLines(file);
    expect(first).toMatchObject({
      level: 'log',
      message: 'hello',
      context: 'Bootstrap',
    });
    expect(typeof first.timestamp).toBe('number');
    expect(second).toMatchObject({
      level: 'warn',
      message: 'careful',
      context: 'Bookings',
    });
  });

  it('keeps console output when a file is configured', async () => {
    const logger = new AppLogger({ file: join(dir, 'app.log') });

    logger.log('hello', 'Bootstrap');
    await flush();

    expect(stdout).toHaveBeenCalled();
  });

  it('records the error message and stack for Error objects', async () => {
    const file = join(dir, 'app.log');
    const logger = new AppLogger({ file });

    logger.error(new Error('boom'), 'Bookings');
    await flush();

    const [entry] = readLines(file);
    expect(entry).toMatchObject({
      level: 'error',
      message: 'boom',
      context: 'Bookings',
    });
    expect(String(entry.stack)).toContain('Error: boom');
    expect(stderr).toHaveBeenCalled();
  });

  it('does not create a file when none is configured', () => {
    const logger = new AppLogger();

    logger.log('hello');

    expect(existsSync(join(dir, 'app.log'))).toBe(false);
    expect(stdout).toHaveBeenCalled();
  });
});
