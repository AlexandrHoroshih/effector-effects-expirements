export class ReEffectError extends Error {
  constructor(message) {
    super(message);

    // stacktrace is useless here (because of async nature), so remove it
    delete this.stack;
  }
}

export class CancelledError extends ReEffectError {
  constructor(strategy) {
    // prettier-ignore
    super(
        'Cancelled due to "' + strategy
      );
  }
}

export class LimitExceededError extends ReEffectError {
  constructor(limit, running) {
    // prettier-ignore
    super(
        'Cancelled due to limit of "' + limit + '" exceeded,' +
        'there are already ' + running + ' running effects'
      )
  }
}

export class TimeoutError extends ReEffectError {
  constructor(timeout) {
    super('Cancelled due to timeout of "' + timeout + '"ms');
  }
}
