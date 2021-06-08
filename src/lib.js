import {
  createDomain,
  createEvent,
  attach,
  combine,
  sample,
  is,
} from "effector";
import { TAKE_ALL, TAKE_LAST, TAKE_FIRST, RACE } from "./strategies";
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

    handler(params, onCancel)
      .then((r) => {
        def.rs(r);

        if (strat === RACE && defs.length > 1) {
          defs.forEach((d) => d !== def && d.rj(new CancelledError(RACE)));
        }
      })
      .catch((e) => {
        def.rj(e);
      });

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
