// TEST FIXTURE (plan 12-06): a migration that fails AFTER doing partial work,
// so a test can prove the transaction rolled back (the file stays at version 1,
// the partial table is absent) and the instance reports not-ready.

module.exports = {
  id: 2,
  slug: 'broken',
  up(conn) {
    conn.exec('CREATE TABLE _broken_partial (x INTEGER)');
    throw new Error('deliberately broken migration');
  },
};
