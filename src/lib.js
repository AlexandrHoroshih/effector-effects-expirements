import {
  createDomain,
  createEvent,
  createStore,
  attach,
  combine,
  sample,
  createEffect,
} from "effector";
import { TAKE_ALL } from "./strategies";
import { createDefer } from "./defer";
import { CancelledError } from "./error";

const rootDomain = createDomain();

const noop = () => {};

const removeItem = (target, item) => {
  const idx = target.findIndex((f) => f === item);
  target.splice(idx, 1);
};

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
  const defers = domain.createStore([]).on(updateDefers, universalReducer);

  sample({
    source: defers,
    clock: stopSignal,
  }).watch((defs) => {
    defs.forEach((d) => d.rj(new CancelledError("")));
    updateDefers([]);
  });

  const patchedHandler = async (params) => {
    let cancel = { handler: noop };
    const onCancel = (fn) => {
      cancel.handler = fn;
    };
    const def = createDefer(cancel);
    updateDefers((defers) => [...defers, def]);

    handler(params, onCancel)
      .then((r) => {
        def.rs(r);
      })
      .catch((e) => {
        def.rj(e);
      });

    const result = await runDeferFx(def);

    updateDefers((defers) => defers.filter((d) => d !== def));

    return result;
  };

  const fx = domain.createEffect(patchedHandler);

  return fx;
};
