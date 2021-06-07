export const createDefer = () => {
  const defer = {};

  defer.req = new Promise((rs, rj) => {
    defer.rs = rs;
    defer.rj = rj;
  });

  return defer;
};
