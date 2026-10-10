// TEST FIXTURE (plan 12-06): a control baseline whose up() leaves a side-effect
// marker, so a test can prove (a) a fresh file never runs up() and (b) two
// processes racing to migrate one version-0 file run it exactly once.
// The short Atomics.wait widens the race window so the second process really
// does queue on the first one's BEGIN IMMEDIATE.

module.exports = {
  id: 1,
  slug: 'baseline',
  requiredTables: ['users', 'deals', 'app_state'],
  up(conn) {
    conn.exec('CREATE TABLE _migration_probe (n INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL)');
    conn.prepare('INSERT INTO _migration_probe (pid) VALUES (?)').run(process.pid);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  },
};
