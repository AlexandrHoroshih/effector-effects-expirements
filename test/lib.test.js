import {
  createDomain,
  fork,
  allSettled,
  forward,
  scopeBind,
  serialize
} from "effector";
import { attachLogger } from "effector-logger/attach";
import { createFx } from "../src/lib";
import { TAKE_LAST } from "../src/strategies";

const wait = async ({ timeout = 1000, value }) =>
  await new Promise((r) => setTimeout(() => r(value), timeout));

test("can be run without scope", async () => {
  let i = 0;

  const d = createDomain();

  const $results = d.createStore([]);
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      i = i + 1;
      const result = await wait({ value: i, timeout });

      return result;
    }
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  await Promise.all([someFx(300), someFx(600), someFx(900)]);

  expect($results.getState()).toEqual([1, 2, 3]);
});

test("can be run in scope", async () => {
  let i = 0;

  const d = createDomain();

  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      i = i + 1;
      const result = await wait({ value: i, timeout });

      return result;
    }
  });

  const someFxTwo = someFx.prepend(() => 600);
  const someFxThree = someFx.prepend(() => 900);

  forward({
    from: run,
    to: [someFx, someFxTwo, someFxThree]
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  // setTimeout(stop, 400)
  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual([1, 2, 3]);
});

test("scope is serializable", async () => {
  let i = 0;

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    handler: async (timeout = 300, onCancel) => {
      i = i + 1;
      const result = await wait({ value: i, timeout });

      return result;
    }
  });

  forward({
    from: run,
    to: [someFx, someFx.prepend(() => 600), someFx.prepend(() => 900)]
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  // setTimeout(stop, 400)
  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual([1, 2, 3]);

  const str = JSON.stringify(serialize(scope));

  console.log(str);

  expect(str).toBeTruthy();
});

test("can cancel all pending effects", async () => {
  let i = 0;

  const d = createDomain();
  const $results = d.createStore([]);
  const stop = d.createEvent();
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    stopSignal: stop,
    handler: async (timeout = 300, onCancel) => {
      i = i + 1;
      const result = await wait({ value: i, timeout });

      return result;
    }
  });

  forward({
    from: run,
    to: [someFx, someFx.prepend(() => 600), someFx.prepend(() => 900)]
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  setTimeout(stop, 400);
  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual([1]);
});

test("forks do not affect each other", async () => {
  const d = createDomain();
  const $results = d.createStore([]);
  const stop = d.createEvent();
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    stopSignal: stop,
    handler: async (timeout = 300, onCancel) => {
      const result = await wait({ value: 1, timeout });

      return result;
    }
  });

  forward({
    from: run,
    to: [someFx, someFx.prepend((x) => x * 2), someFx.prepend((x) => x * 3)]
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

  expect(scopeA.getState($results)).toEqual(scopeB.getState($results));
});

test("take last", async () => {
  let i = 0;

  const d = createDomain();
  const $results = d.createStore([]);
  const run = d.createEvent();
  const someFx = createFx({
    domain: d,
    strategy: TAKE_LAST,
    handler: async (timeout = 300, onCancel) => {
      i = i + 1;
      const result = await wait({ value: i, timeout });

      return result;
    }
  });

  forward({
    from: run,
    to: [someFx, someFx.prepend(() => 600), someFx.prepend(() => 900)]
  });

  $results.on(someFx.doneData, (arr, r) => [...arr, r]);

  const scope = fork(d);

  // setTimeout(stop, 400)
  await allSettled(run, { scope, params: 300 });

  expect(scope.getState($results)).toEqual([3]);
});
