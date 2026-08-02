// D-13: the standard M&A due-diligence request checklist — the reviewable
// SOURCE OF TRUTH for the 80-item seed set every new deal inherits via
// db/dealSeed.js's DEAL_SEED_COLLECTIONS allowlist. The row this module
// produces inside `data/demo.db`'s `ddRequestTemplates` table (written by
// scripts/seed-dd-request-templates.js) is a DERIVED COPY of the object
// exported here — a change to the standard list is authored in THIS file
// and then re-run through the seeding script, never edited directly inside
// the binary SQLite artifact, so the standard's evolution shows up as a
// readable diff rather than an opaque blob change.
//
// Item texts are transcribed verbatim (no paraphrasing, no reordering) from
// 04-RESEARCH.md's "Seeded DD Request Checklist Content (D-13)" section —
// one semicolon-separated phrase per item, in the order listed there. That
// section is itself tagged [ASSUMED] (synthesized from general M&A
// practice, not one single authoritative checklist source); locking it here
// as the seed set is this plan's own explicit purpose (D-13: "the planner
// locks the item set").
'use strict';

const { DD_AREA_IDS } = require('./accessPolicy');

// Area id -> the eight raw phrase lists, each exactly 10 items, in the exact
// order 04-RESEARCH.md lists them under that area's heading.
const AREA_ITEM_TEXT = {
  legal: [
    'Certificate of incorporation / good standing',
    'Articles of association & amendments',
    'Cap table and shareholder register',
    'Top 20 material contracts by value',
    'Litigation/dispute history (5 yrs, open + settled)',
    'IP register (patents/trademarks/copyrights/domains) + assignment agreements',
    'Real estate leases & property title',
    'Regulatory licenses & permits',
    'Change-of-control clauses in key contracts',
    'Outstanding guarantees/liens/security interests',
  ],
  financial: [
    'Audited financial statements (3 fiscal years)',
    'Management accounts (trailing 12 months)',
    'Revenue by customer/product (top-20 concentration)',
    'AR/AP aging schedules',
    'Debt schedule & loan covenants',
    'Capex history & forward plan',
    'Working-capital / normalized net-debt analysis',
    'Related-party transactions',
    'Off-balance-sheet liabilities & contingencies',
    'Budget-vs-actual variance (trailing 12 months)',
  ],
  tax: [
    'Corporate tax returns (3 years, all jurisdictions)',
    'Transfer pricing documentation & intercompany agreements',
    'Tax audit history & open assessments',
    'VAT/sales-tax filings & compliance status',
    'Tax loss carryforwards & deferred tax assets',
    'Tax-sharing / tax-indemnification agreements',
    'Withholding-tax positions on cross-border payments',
    'R&D tax-credit claims & substantiation',
    'Payroll tax compliance records',
    'Advance pricing agreements / tax rulings',
  ],
  hr: [
    'Organization chart with reporting lines',
    'Employment agreements — executives & key employees',
    'Compensation/benefits summary by role/level',
    'Employee handbook & HR policies',
    'Union / works-council agreements & CBAs',
    'Pending employment litigation or grievances',
    'Headcount by function/location with tenure',
    'Severance & change-of-control (golden-parachute) terms',
    'Pension/retirement plan obligations',
    'Workplace safety & compliance incident history',
  ],
  it: [
    'IT systems inventory (ERP/CRM/core apps)',
    'Network architecture & infrastructure diagram',
    'Cybersecurity policies & incident history (3 yrs)',
    'Data-privacy compliance status (GDPR/CCPA as applicable)',
    'Software licenses & vendor contracts',
    'Disaster-recovery / business-continuity plan',
    'Source-code ownership & escrow arrangements',
    'Cloud-hosting agreements & SLAs',
    'Access-control & identity-management practices',
    'Open IT integration/separation dependencies (TSAs)',
  ],
  commercial: [
    'Top-20 customer contracts & revenue concentration',
    'Customer churn/retention analysis',
    'Sales pipeline & backlog',
    'Pricing policies & discount structures',
    'Distribution/channel-partner agreements',
    'Competitive positioning & market-share analysis',
    'Customer-satisfaction/NPS data',
    'Key-account change-of-control consent requirements',
    'Marketing & brand-asset inventory',
    'Product roadmap & R&D pipeline',
  ],
  operations: [
    'Manufacturing/production facility list & capacity utilization',
    'Supply-chain map & key supplier contracts',
    'Quality-management certifications (ISO / industry-specific)',
    'Inventory levels & turnover',
    'Equipment/asset register & condition assessment',
    'Health & safety compliance records',
    'Business-continuity / single-point-of-failure risks',
    'Logistics & distribution network',
    'Outsourced/third-party operational dependencies',
    'Capacity-expansion plans & constraints',
  ],
  complianceEsg: [
    'Environmental permits & compliance history',
    'Sustainability/ESG reporting & targets',
    'Anti-bribery & corruption (ABC) policy & training records',
    'Export-control & trade-sanctions compliance',
    'Data-protection/privacy compliance program',
    'Regulatory investigations or enforcement actions (open/closed)',
    'DEI metrics & initiatives',
    'Product-safety/regulatory certifications',
    'Whistleblower/ethics-hotline records',
    'Carbon-footprint/emissions disclosures',
  ],
};

// Interface contract's seven role strings — Tax has no dedicated role of its
// own (mirroring 04-RESEARCH.md Pitfall 4's "no dedicated tax workstream
// exists — folded into Finance") so the `tax` area's items carry the same
// `Finance` ownerHint as `financial`'s.
const AREA_OWNER_HINT = {
  legal: 'Legal',
  financial: 'Finance',
  tax: 'Finance',
  hr: 'HR',
  it: 'IT',
  commercial: 'Commercial',
  operations: 'Operations',
  complianceEsg: 'Compliance',
};

function pad2(n) { return String(n).padStart(2, '0'); }

function buildItems() {
  const items = [];
  DD_AREA_IDS.forEach((area) => {
    const texts = AREA_ITEM_TEXT[area];
    texts.forEach((text, i) => {
      items.push({
        id: `dd_${area}_${pad2(i + 1)}`,
        area,
        text,
        ownerHint: AREA_OWNER_HINT[area],
      });
    });
  });
  return items;
}

const DD_REQUEST_TEMPLATE = {
  id: 'ddtpl_standard',
  name: 'Standard M&A due-diligence request list',
  version: 1,
  items: buildItems(),
};

module.exports = { DD_REQUEST_TEMPLATE };
