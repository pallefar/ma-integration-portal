// VAL-01: the content surface — courses/lessons, pages (incl. the layout
// block builder), banners, menus, slides (+ upload), media, i18n.
//
// VAL-02/D-15 note: this module's HTML-bearing fields (page/lesson `body`,
// and the richtext block's `data.html`) are tagged with htmlField() in Task
// 3 — see the tagged-field inventory comment near the bottom of
// validators/index.js once that lands. Every OTHER field below (title,
// description, banner message, menu labels, …) is plain text, rendered via
// textContent/esc() client-side, and is deliberately left untagged.
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema, htmlField, urlField } = require('./index');

const ID_MAX = 120;
const NAME_MAX = 300;
const TEXT_MAX = 4000;
const HTML_MAX = 20000; // richtext/lesson body — long-form authored content
const LARGE_BLOB_MAX = 70000000; // base64 media payload text — see validators/settings.js's identical rationale

// A CMS text field is either a plain string OR an i18n map ({en:'...',
// de:'...'}) — this codebase's admin-cms.js editors send the i18n shape for
// every localized field (title/description/body/…) and a plain string for
// a handful of non-localized ones (e.g. a bookmark's label). Accepting
// both matches what's actually sent rather than forcing one shape.
function i18nOrString(max) {
  return z.union([
    z.string().max(max),
    z.record(z.string().max(10), z.string().max(max).nullable()),
  ]);
}

// ---------------------------------------------------------------------------
// Courses & lessons — POST /api/courses (whole-course upsert) and
// POST /api/courses/:courseId/lessons (single-lesson upsert within a
// module). `title` stays required (not `.optional()`) because
// public/js/admin-cms.js's course editor ALWAYS sends a title object (even
// `{}` for a still-empty draft, which is a valid, non-empty JS object and
// therefore already passed the handler's own truthy `!course.title` check
// today) — this schema's requirement matches, not narrows, that behaviour.
// ---------------------------------------------------------------------------
const QuizQuestionSchema = z.object({
  question: i18nOrString(500).optional(),
  options: z.array(i18nOrString(300)).max(20).optional(),
  correctIndex: z.number().optional(),
  score: z.number().optional(),
});
const QuizSchema = z.object({
  passMark: z.number().optional(),
  questions: z.array(QuizQuestionSchema).max(50).optional(),
}).optional();

const LessonSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  title: i18nOrString(NAME_MAX).optional(),
  description: i18nOrString(TEXT_MAX).optional(),
  // VAL-02/D-15: public/js/employee.js's openLessonModal() renders
  // `l.body` RAW into innerHTML (`cmsLabel(l.body, lang) || ...`) — the one
  // genuinely HTML-bearing lesson field. `title`/`description` are always
  // rendered through cmsEsc() (plain text) and stay untagged.
  body: htmlField(i18nOrString(HTML_MAX)).optional(),
  xp: z.number().optional(),
  dimension: z.string().max(60).optional(),
  playbookLink: urlField(2000).optional(), // [security] CR-B01/WR-B04: lesson modal href
  prerequisite: z.string().max(ID_MAX).nullable().optional(),
  order: z.number().optional(),
  quiz: QuizSchema,
});
registerSchema('POST', '/api/courses/:courseId/lessons', z.object({
  moduleId: z.string().trim().min(1, 'Module not found.').max(ID_MAX).optional(),
  lesson: LessonSchema,
}).refine((data) => data.lesson !== undefined, { message: 'Lesson payload required.', path: ['lesson'] }));
registerSchema('DELETE', '/api/courses/:courseId/lessons/:lessonId', EmptyBodySchema);

const CourseModuleSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  order: z.number().optional(),
  title: i18nOrString(NAME_MAX).optional(),
  subtitle: i18nOrString(600).optional(),
  badge: i18nOrString(NAME_MAX).optional(),
  dimension: z.string().max(60).optional(),
  lessons: z.array(LessonSchema).max(500).optional(),
});

const CourseUpsertSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  title: i18nOrString(NAME_MAX),
  description: i18nOrString(TEXT_MAX).optional(),
  gating: z.string().max(20).optional(),
  certificateOnComplete: z.boolean().optional(),
  xpPerLesson: z.number().optional(),
  published: z.boolean().optional(),
  modules: z.array(CourseModuleSchema).max(200).optional(),
});
registerSchema('POST', '/api/courses', CourseUpsertSchema);
registerSchema('DELETE', '/api/courses/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// i18n — POST /api/i18n accepts a bulk merge shape (languages/defaultLang/
// strings) AND a single-key convenience shape ({lang, key, value}); both
// are optional-and-independent in the handler (each `if` branch is
// checked separately), so every field here is optional.
// ---------------------------------------------------------------------------
const I18nUpdateSchema = z.object({
  languages: z.array(z.string().max(10)).max(20).optional(),
  defaultLang: z.string().max(10).optional(),
  strings: z.record(z.string().max(10), z.record(z.string().max(160), z.string().max(TEXT_MAX))).optional(),
  lang: z.string().max(10).optional(),
  key: z.string().max(160).optional(),
  value: z.string().max(TEXT_MAX).optional(),
});
registerSchema('POST', '/api/i18n', I18nUpdateSchema);

// ---------------------------------------------------------------------------
// Menus — sidebar links, groups, landing cards, bookmarks. Every array is
// independently optional in the handler (`if (Array.isArray(body.x))
// db.menus.x = body.x`).
// ---------------------------------------------------------------------------
const SidebarItemSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  group: z.string().max(60).optional(),
  label: i18nOrString(NAME_MAX).optional(),
  icon: z.string().max(20).optional(),
  href: urlField(500).optional(), // [security] CR-B01/WR-B04: custom sidebar link href
  order: z.number().optional(),
  visible: z.boolean().optional(),
  roleScope: z.string().max(60).optional(),
  custom: z.boolean().optional(),
});
const MenuGroupSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  label: i18nOrString(NAME_MAX).optional(),
  icon: z.string().max(20).optional(),
  order: z.number().optional(),
  visible: z.boolean().optional(),
});
const LandingCardSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  icon: z.string().max(20).optional(),
  title: i18nOrString(NAME_MAX).optional(),
  href: urlField(500).optional(), // [security] CR-B01/WR-B04: landing card href
  order: z.number().optional(),
});
const BookmarkSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  icon: z.string().max(20).optional(),
  label: z.string().max(NAME_MAX).optional(),
  page: urlField(NAME_MAX).optional(), // [security] CR-B01/WR-B04: quick-nav bookmark href (page + #section)
  section: z.string().max(120).optional(),
  order: z.number().optional(),
});
const MenusUpdateSchema = z.object({
  sidebar: z.array(SidebarItemSchema).max(500).optional(),
  groups: z.array(MenuGroupSchema).max(200).optional(),
  landingCards: z.array(LandingCardSchema).max(200).optional(),
  bookmarks: z.array(BookmarkSchema).max(200).optional(),
});
registerSchema('POST', '/api/menus', MenusUpdateSchema);

// ---------------------------------------------------------------------------
// Pages — the layout block builder (richtext/hero/cards/cta, matching
// public/js/page-layout.js's REGISTRY exactly) plus the legacy `body` field.
// Only `richtext`'s `data.html` and the top-level `body` are markup —
// modeling `data` as a fixed object (not an open record) is what lets Task
// 3 tag exactly `html` and leave `title`/`subtitle`/`heading`/`items`/`text`/
// `button` as the plain text every other block type actually renders them
// as (via esc(), never raw innerHTML).
// ---------------------------------------------------------------------------
const PageBlockDataSchema = z.object({
  // VAL-02/D-15: public/js/page-layout.js's REGISTRY renders ONLY the
  // richtext block's `data.html` raw (`sanitize(L(d.html))` — the
  // client-side render-time discipline this write-time control adds a
  // second gate ahead of); hero/cards/cta's title/subtitle/heading/items/
  // text/button/cta/href/ctaHref are all rendered via esc() and stay
  // untagged plain text.
  html: htmlField(i18nOrString(HTML_MAX)).optional(),
  title: i18nOrString(NAME_MAX).optional(),
  subtitle: i18nOrString(600).optional(),
  cta: i18nOrString(120).optional(),
  ctaHref: urlField(500).optional(), // [security] CR-B01/WR-B04: hero CTA href
  heading: i18nOrString(NAME_MAX).optional(),
  items: i18nOrString(TEXT_MAX).optional(),
  text: i18nOrString(TEXT_MAX).optional(),
  button: i18nOrString(120).optional(),
  href: urlField(500).optional(), // [security] CR-B01/WR-B04: cta block href
}).optional();
const PageLayoutBlockSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX),
  type: z.enum(['richtext', 'hero', 'cards', 'cta']),
  order: z.number().optional(),
  visible: z.boolean().optional(),
  data: PageBlockDataSchema,
});
const PageUpsertSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  slug: z.string().trim().max(160).optional(),
  title: i18nOrString(NAME_MAX).optional(),
  // VAL-02/D-15: the legacy CMS body — public/js/page-layout.js's fallback
  // ladder renders it raw (`sanitize(body)`) when a page has no `layout`
  // blocks yet. Tagged the same way `data.html` is above.
  body: htmlField(i18nOrString(HTML_MAX)).optional(),
  layout: z.array(PageLayoutBlockSchema).max(200).optional(),
  published: z.boolean().optional(),
});
registerSchema('POST', '/api/pages', PageUpsertSchema);
registerSchema('DELETE', '/api/pages/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Banners — title/message are rendered via textContent (public/js/
// banners.js's own header comment: "XSS-safe: title/message are set via
// textContent, never innerHTML") — plain text, not HTML-bearing.
// ---------------------------------------------------------------------------
const BannerUpsertSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  type: z.string().max(20).optional(),
  title: i18nOrString(NAME_MAX).optional(),
  message: i18nOrString(TEXT_MAX).optional(),
  scope: z.string().max(20).optional(),
  pages: z.array(z.string().max(200)).max(200).optional(),
  roleScope: z.string().max(60).optional(),
  dismissible: z.boolean().optional(),
  active: z.boolean().optional(),
  priority: z.union([z.number(), z.string().max(10)]).optional(),
  start: z.string().max(60).nullable().optional(),
  end: z.string().max(60).nullable().optional(),
  rev: z.union([z.number(), z.string().max(10)]).optional(),
});
registerSchema('POST', '/api/banners', BannerUpsertSchema);
registerSchema('DELETE', '/api/banners/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Media library — a base64 upload; fileName/fileData required by the
// handler's own check. The binary content itself is not schema-validated
// (per the plan's own instruction — metadata and declared size only); the
// existing upload-path size handling in server.js is unchanged.
// ---------------------------------------------------------------------------
const MediaUploadSchema = z.object({
  fileName: z.string().trim().min(1, 'fileName and fileData are required.').max(300),
  fileData: z.string().min(1, 'fileName and fileData are required.').max(LARGE_BLOB_MAX),
  kind: z.string().trim().max(120).optional(),
});
registerSchema('POST', '/api/media', MediaUploadSchema);
registerSchema('DELETE', '/api/media/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// HTML slides — a pasted link OR an uploaded file (handled by a separate
// upload route). `url` is unconditionally required by the handler's own
// check (both create AND update paths).
// ---------------------------------------------------------------------------
const SlideUpsertSchema = z.object({
  id: z.string().max(ID_MAX).optional(),
  url: z.string().trim().min(1, 'A slide link (url) is required.').max(2000),
  icon: z.string().max(20).optional(),
  label: z.string().max(NAME_MAX).optional(),
  pages: z.union([z.string().max(60), z.array(z.string().max(200)).max(200)]).optional(),
});
registerSchema('POST', '/api/slides', SlideUpsertSchema);
registerSchema('DELETE', '/api/slides/:id', EmptyBodySchema);

// `content` is the raw uploaded HTML file's bytes as a string — deliberately
// NOT `.trim()`-ed as a schema transform (that would silently strip leading/
// trailing whitespace from the persisted FILE, unlike every other field
// above where `.trim()` only tightens a display label). The handler's own
// "no content received" check already treats an all-whitespace string as
// empty, so this schema's refine() mirrors that exactly without mutating
// the stored bytes.
//
// SAFE-03 / D-13-04 (a) (13-03, PD-16): `type` is the browser's declared MIME
// type and `encoding` says how `content` is carried ('utf8' text — the HTML
// contract, the default — or 'base64' for the binary slide types). The route's
// own checkUpload() (lib/slideUpload.js) owns the allowlist, magic bytes, the
// 10 MB limit and the library quota; the schema only bounds the shapes.
const SlideUploadSchema = z.object({
  filename: z.string().max(300).optional(),
  type: z.string().max(100).optional(),
  encoding: z.enum(['utf8', 'base64']).optional(),
  content: z.string().min(1, 'No slide file content received.').max(LARGE_BLOB_MAX)
    .refine((s) => s.trim().length > 0, { message: 'No slide file content received.' }),
});
registerSchema('POST', '/api/slides/upload', SlideUploadSchema);

module.exports = {
  i18nOrString,
  LessonSchema,
  CourseModuleSchema,
  CourseUpsertSchema,
  I18nUpdateSchema,
  MenusUpdateSchema,
  PageBlockDataSchema,
  PageLayoutBlockSchema,
  PageUpsertSchema,
  BannerUpsertSchema,
  MediaUploadSchema,
  SlideUpsertSchema,
  SlideUploadSchema,
};
