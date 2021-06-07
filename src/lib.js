import { createDomain, createEvent, attach, combine, sample } from "effector";
import { TAKE_ALL } from "./strategies";
import { createDefer } from "./defer";

const rootDomain = createDomain();

const noop = () => {};

const wrap = (fn) => {
  const wrapped = async (...args) => await fn(...args);

  return wrapped;
};

const withFn = (prev, next) => {
  if (typeof next !== "function") {
    return next;
  }

  return next(prev);
};

export const createFx = ({
  handler,
  stopSignal = createEvent(),
  domain = rootDomain,
  strategy = TAKE_ALL
}) => {
  const updateDefers = domain.createEvent();
  const $defers = domain.createStore([]).on(updateDefers, withFn);

  const updateCancellers = domain.createEvent();
  const $cancellers = domain.createStore([]).on(updateCancellers, withFn);
  const onCancel = (fn) => {
    const withCleanup = () => {
      fn();

      updateCancellers((cls) => cls.filter((c) => c !== withCleanup));
    };

    updateCancellers((cls) => [...cls, withCleanup]);
  };

  const $state = combine({ defers: $defers, cancellers: $cancellers });

  sample({
    source: $state,
    clock: stopSignal
  }).watch(({ cancellers, defers }) => {
    cancellers.forEach((clean) => clean());
    updateCancellers([]);
    defers.forEach((def) => def.rj("Cancelled!"));
    updateDefers([]);
  });

  const patchedHandler = async (params) => {
    const scopedDef = updateDefers;

    const def = createDefer();
    scopedDef((defers) => [...defers, def]);

    wrap(handler)(params, onCancel)
      .then((r) => {
        console.log(r);
        def.rs(r);
        scopedDef((defers) => defers.filter((d) => d !== def));
      })
      .catch((e) => {
        def.rj(e);
        scopedDef((defers) => defers.filter((d) => d !== def));
      });

    const result = await def.req;

    return result;
  };

  const fx = domain.createEffect(patchedHandler);

  return fx;
};
