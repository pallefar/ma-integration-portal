// TEST FIXTURE (plan 12-06): a stamp-only migration flagged `backup: true`, to
// exercise the PD-28 disk precondition, the .pre-v2.bak and stale-backup rules.

module.exports = {
  id: 2,
  slug: 'backup-probe',
  backup: true,
  up() { /* stamp-only */ },
};
