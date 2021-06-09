import { CancelledError } from "./error";

export const createDefer = (config) => {
  const defer = { done: false };

  defer.req = new Promise((rs, rj) => {
    defer.rs = (...args) => {
      if (!defer.done) {
        defer.done = true;
        rs(...args);
      }
    };

    defer.rj = (...args) => {
      if (!defer.done) {
        defer.done = true;
        if (args[0] instanceof CancelledError) {
          config.handler(...args);
        }

        rj(...args);
      }
    };
  });

  return defer;
};
