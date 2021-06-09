import {
  createDomain,
  createEvent,
  attach,
  combine,
  sample,
  guard,
  is,
  scopeBind,
} from "effector";
import { TAKE_ALL, TAKE_LAST, TAKE_FIRST, RACE, QUEUE } from "./strategies";
import { createDefer } from "./defer";
import { CancelledError } from "./error";

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
  stopSignal = createEvent(),
  domain = rootDomain,
  strategy = TAKE_ALL,
}) => {
  const runDeferFx = domain.createEffect(async (def) => await def.req);
  const updateDefers = domain.createEvent();
  const currentStrategy = is.store(strategy)
    ? strategy
    : domain.createStore(strategy);
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

  const readyToRun = guard({
    source: queue,
    clock: [queue, canRun],
    filter: canRun,
  }).map((q) => q[0]);

  queue.on(readyToRun, (queue, param) => queue.filter((q) => q !== param));

  readyToRun.watch((config) => {
    const { params, def, onCancel, strat } = config;
    const scopedStop = isomorphicScopeBind(stopSignal);

    handler(params, onCancel)
      .then((r) => {
        def.rs(r);
      })
      .catch((e) => {
        def.rj(e);
      })
      .finally(() => strat === RACE && scopedStop());
  });

  sample({
    source: defers,
    clock: stopSignal,
  }).watch((defs) => {
    defs.forEach((d) => d.rj(new CancelledError("")));
    updateDefers([]);
  });

  const patchedHandler = async ({ params, defs, strat }) => {
    if (strat === TAKE_FIRST && defs.length === 1) {
      throw new CancelledError(TAKE_FIRST);
    }

    if (strat === TAKE_LAST && defs.length > 0) {
      defs.forEach((d) => d.rj(new CancelledError(TAKE_LAST)));
      updateDefers([]);
    }

    let cancel = { handler: noop };
    const onCancel = (fn) => {
      cancel.handler = fn;
    };
    const def = createDefer(cancel);
    updateDefers((defers) => [...defers, def]);

    setRun({ params, def, onCancel, strat });

    const result = await runDeferFx(def);

    updateDefers((defers) => defers.filter((d) => d !== def));

    return result;
  };

  const fx = attach({
    effect: domain.createEffect(patchedHandler),
    source: combine([defers, currentStrategy]),
    mapParams: (params, [defs, strat]) => ({
      params,
      defs,
      strat,
    }),
  });

  return fx;
};
