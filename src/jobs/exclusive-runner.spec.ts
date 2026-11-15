import { Logger } from '@nestjs/common';
import { ExclusiveRunner } from './exclusive-runner';

function fakeLogger() {
  return { log: jest.fn(), error: jest.fn() } as unknown as Logger & {
    log: jest.Mock;
    error: jest.Mock;
  };
}

/** A batch that returns the queued counts in order, then 0. */
const batches = (...counts: number[]) =>
  jest.fn(async () => counts.shift() ?? 0);

describe('ExclusiveRunner', () => {
  it('runs one batch when it comes back short, and logs the total', async () => {
    const logger = fakeLogger();
    const batch = batches(3);
    await new ExclusiveRunner(logger, 10).run('expired', batch);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('expired: 3');
  });

  it('repeats while full batches come back', async () => {
    const logger = fakeLogger();
    const batch = batches(10, 10, 4);
    await new ExclusiveRunner(logger, 10).run('expired', batch);

    expect(batch).toHaveBeenCalledTimes(3);
    expect(logger.log).toHaveBeenCalledWith('expired: 24');
  });

  it('stops after maxBatches even if batches stay full', async () => {
    const logger = fakeLogger();
    const batch = jest.fn(async () => 5);
    await new ExclusiveRunner(logger, 5, 3).run('sent', batch);

    expect(batch).toHaveBeenCalledTimes(3);
    expect(logger.log).toHaveBeenCalledWith('sent: 15');
  });

  it('logs nothing when there was nothing to do', async () => {
    const logger = fakeLogger();
    await new ExclusiveRunner(logger, 10).run('expired', batches(0));

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous run is still going', async () => {
    const logger = fakeLogger();
    const runner = new ExclusiveRunner(logger, 10);
    let release!: () => void;
    const slow = jest.fn(
      () => new Promise<number>((resolve) => (release = () => resolve(1))),
    );
    const other = jest.fn(async () => 1);

    const first = runner.run('job', slow);
    await runner.run('job', other); // overlapping tick: skipped at once
    expect(other).not.toHaveBeenCalled();

    release();
    await first;
    await runner.run('job', other); // free again
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('logs a failure (message only), never throws, and runs again next tick', async () => {
    const logger = fakeLogger();
    const runner = new ExclusiveRunner(logger, 10);

    await expect(
      runner.run('outbox', async () => {
        throw new Error('broker down');
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('outbox failed: broker down');

    const next = batches(2);
    await runner.run('outbox', next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reports a non-Error throw without its value', async () => {
    const logger = fakeLogger();
    await new ExclusiveRunner(logger, 10).run('job', async () => {
      throw 'secret-token-value';
    });
    expect(logger.error).toHaveBeenCalledWith('job failed: unknown error');
  });
});
