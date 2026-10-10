'use strict';
// R5-02 (v3.0 review): tests used `app.listen(0)`, which binds `::` while every
// fetch targets 127.0.0.1. On macOS a foreign process listening on 127.0.0.1:<same port>
// coexists with a `::` listener and WINS the connect, so a random foreign server answered
// ("Endpoint not found") and tests flaked ~1-in-3 full runs. Binding the EXACT address the
// tests connect to makes the OS pick a port that is free on 127.0.0.1.
//
// An explicit host makes Node resolve it asynchronously, so `server.address()` is null until
// 'listening' fires — callers must await this helper instead of reading the port synchronously.
function listenLocal(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

module.exports = { listenLocal };
