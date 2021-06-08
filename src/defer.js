import { CancelledError } from "./error";

export const createDefer = (config) => {
  const defer = {};

  defer.req = new Promise((rs, rj) => {
    defer.rs = rs;
    defer.rj = (...args) => {
      if (args[0] instanceof CancelledError) {
        config.handler(...args);
      }

      rj(...args);
    };
  });

  return defer;
};
