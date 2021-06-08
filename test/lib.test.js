import {
  createDomain,
  fork,
  allSettled,
  forward,
  scopeBind,
  serialize,
} from "effector";
import { attachLogger } from "effector-logger/attach";
import { createFx } from "../src/lib";
import { TAKE_LAST } from "../src/strategies";

const wait = async ({ timeout = 1000, value }) =>
  await new Promise((r) => setTimeout(() => r(value), timeout));

test("can be run without scope", async () => {
  const fn = jest.fn();

  const d = createDomain();

  const $results = d.createStore([]);
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  await Promise.all([someFx(300), someFx(600), someFx(900)]);

  expect($results.getState()).toEqual(fn.mock.calls.map(([arg]) => arg));
});

test("can be run in scope", async () => {
  const fn = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  forward({
    from: run,
    to: someFx,
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual(fn.mock.calls.map(([arg]) => arg));
});

test("resolves to scope in watcher", async () => {
  const fn = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  run.watch(() => {
    const scoped = scopeBind(someFx);

    scoped(300);
    scoped(600);
    scoped(900);
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual(fn.mock.calls.map(([arg]) => arg));
});

test("can be run in scope as inner fx", async () => {
  const fn = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  const runnerFx = d.createEffect(async () => {
    await someFx();
    await someFx(600);
    await someFx(900);
  });

  forward({
    from: run,
    to: runnerFx,
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual(fn.mock.calls.map(([arg]) => arg));
});

test("scope is serializable", async () => {
  const fn = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  const runnerFx = d.createEffect(async () => {
    await someFx();
    await someFx(600);
    await someFx(900);
  });

  forward({
    from: run,
    to: runnerFx,
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual(fn.mock.calls.map(([arg]) => arg));

  const str = JSON.stringify(serialize(scope));

  expect(str).toBeTruthy();
  expect(str.length > 2).toBeTruthy();
});

test("can cancel all pending effects", async () => {
  const fn = jest.fn();
  const whenCancelled = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const stop = d.createEvent();
  const someFx = createFx({
    domain: d,
    stopSignal: stop,
    handler: async (timeout = 300, onCancel) => {
      fn(timeout);
      onCancel((e) => {
        console.log("Cancelled called!", e);
        whenCancelled();
      });
      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  const waitFx = d.createEffect(
    async (t) => await wait({ value: t, timeout: t })
  );

  forward({
    from: run,
    to: waitFx.prepend(() => 400),
  });

  forward({
    from: waitFx.done,
    to: stop,
  });

  run.watch(() => {
    const scoped = scopeBind(someFx);

    scoped(300);
    scoped(600);
    scoped(900);
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual(
    fn.mock.calls.map(([arg]) => arg).slice(0, 1)
  );
  expect(whenCancelled.mock.calls.length).toEqual(2);
});

test("forks do not affect each other", async () => {
  const whenCancelled = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const stop = d.createEvent();
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    stopSignal: stop,
    handler: async (timeout = 300, onCancel) => {
      onCancel(() => whenCancelled());

      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  run.watch((x) => {
    const scoped = scopeBind(someFx);

    scoped(x);
    scoped(x * 2);
    scoped(x * 3);
  });

  run.watch((t) => {
    const scopedStop = scopeBind(stop);

    setTimeout(scopedStop, t * 1.5);
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scopeA = fork(d);
  const scopeB = fork(d);

  await allSettled(run, { scope: scopeA, params: 100 });
  await allSettled(run, { scope: scopeB, params: 300 });

  expect(scopeA.getState($results)).toEqual([100]);
  expect(scopeB.getState($results)).toEqual([300]);
  expect(whenCancelled.mock.calls.length).toEqual(4);
});

test("take last", async () => {
  const whenCancelled = jest.fn();

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    strategy: TAKE_LAST,
    handler: async (timeout = 300, onCancel) => {
      onCancel(() => whenCancelled());

      const result = await wait({ value: timeout, timeout });

      return result;
    },
  });

  run.watch((x) => {
    const scoped = scopeBind(someFx);

    scoped(x);
    scoped(x * 2);
    scoped(x * 3);
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  await allSettled(run, { scope, params: 100 });

  expect(whenCancelled.mock.calls.length).toEqual(2);
});
