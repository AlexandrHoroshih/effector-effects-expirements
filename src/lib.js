import {
  createDomain,
  attach,
  combine,
  sample,
  guard,
  is,
  forward,
  scopeBind,
} from "effector";
import { TAKE_ALL, TAKE_LAST, TAKE_FIRST, RACE, QUEUE } from "./strategies";
import { createDefer } from "./defer";
import { CancelledError, LimitExceededError, TimeoutError } from "./error";

const rootDomain = createDomain();

const noop = () => {};

const universalReducer = (prev, next) => {
  if (typeof next !== "function") {
    return next;
  }

  return next(prev);
};

const isomorphicScopeBind = (event) => {
  let bindEvent = event;

  // a hack, because scopeBind throws, if called not in scope
  // need to send issue to the the author about that
  // would expect a noop for non-scope case
  // following try-catch sort of implements this behaviour
  try {
    bindEvent = scopeBind(event);
  } catch (e) {
    bindEvent = event;
  }

  return bindEvent;
};

export const createFx = ({
  handler,
  domain = rootDomain,
  strategy = TAKE_ALL,
  limit = null,
  timeout = null,
}) => {
  const stopSignal = domain.createEvent();
  const cancel = domain.createEvent();

  const cancelled = domain.createEvent();
  const runDeferFx = domain.createEffect(async (def) => await def.req);
  const updateDefers = domain.createEvent();
  const currentStrategy = is.store(strategy)
    ? strategy
    : domain.createStore(strategy);
  const currentLimit = is.store(limit) ? limit : domain.createStore(limit);
  const currentTimeout = is.store(timeout)
    ? timeout
    : domain.createStore(timeout);
  const defers = domain.createStore([]).on(updateDefers, universalReducer);

  const setRun = domain.createEvent();
  const queue = domain
    .createStore([])
    .on(setRun, (runs, param) => [...runs, param]);
  const canRun = combine(queue, defers, currentStrategy, (q, defs, strat) => {
    if (strat === QUEUE) {
      return q.length > 0 && q.length === defs.length;
    }

    return q.length > 0;
  });

  forward({
    from: cancel,
    to: stopSignal,
  });

  const readyToRun = guard({
    source: queue,
    clock: [queue, canRun],
    filter: canRun,
  }).map((q) => q[0]);

  queue.on(readyToRun, (queue, param) => queue.filter((q) => q !== param));

  readyToRun.watch((config) => {
    const { params, def, onCancel, strat, time } = config;
    const scopedStop = isomorphicScopeBind(stopSignal);

    handler(params, onCancel)
      .then((r) => {
        def.rs(r);
      })
      .catch((e) => {
        def.rj(e);
      })
      .finally(() => strat === RACE && scopedStop());

    if (time) {
      setTimeout(() => {
        def.rj(new TimeoutError(time));
      }, time);
    }
  });

  sample({
    source: defers,
    clock: stopSignal,
  }).watch((defs) => {
    defs.forEach((d) => d.rj(new CancelledError("")));
    updateDefers([]);
  });

  const patchedHandler = async ({ params, defs, strat, lim, time }) => {
    if (lim && defs.length === lim) {
      const error = new LimitExceededError();
      cancelled(error);
      throw new LimitExceededError();
    }

    if (strat === TAKE_FIRST && defs.length === 1) {
      const error = new CancelledError(TAKE_FIRST);
      cancelled(error);
      throw error;
    }

    if (strat === TAKE_LAST && defs.length > 0) {
      defs.forEach((d) => d.rj(new CancelledError(TAKE_LAST)));
      updateDefers([]);
    }

    const scopedCancelled = isomorphicScopeBind(cancelled);

    let cancel = { handler: noop, cancelled: scopedCancelled };
    const onCancel = (fn) => {
      cancel.handler = fn;
    };
    const def = createDefer(cancel);
    updateDefers((defers) => [...defers, def]);

    setRun({ params, def, onCancel, strat, time });

    const result = await runDeferFx(def);

    updateDefers((defers) => defers.filter((d) => d !== def));

    return result;
  };

  const fx = attach({
    effect: domain.createEffect(patchedHandler),
    source: combine([defers, currentStrategy, currentLimit, currentTimeout]),
    mapParams: (params, [defs, strat, lim, time]) => ({
      params,
      defs,
      strat,
      lim,
      time,
    }),
  });

  fx.cancel = cancel;
  fx.cancelled = cancelled;

  return fx;
};
