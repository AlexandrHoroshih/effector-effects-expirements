export const createDefer = (config) => {
  const defer = {};

  defer.req = new Promise((rs, rj) => {
    defer.rs = rs;
    defer.rj = (...args) => {
      config.handler(...args);
      rj(...args);
    };
  });

  return defer;
};
