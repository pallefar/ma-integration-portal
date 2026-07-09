/**
 * TE Connectivity M&A Portal — admin-cms.js
 * Phase 3: Course / Module / Lesson / Quiz editor for the admin Courses panel.
 * Owns the #courses-admin-list surface. Talks to /api/courses (+ nested lesson endpoints).
 */
(function () {
  const LANGS = [['en', '🇬🇧 English'], ['de', '🇩🇪 Deutsch'], ['zh', '🇨🇳 中文'], ['cs', '🇨🇿 Čeština']];
  const DIMS = [['culture', 'Culture & Values'], ['talent', 'Talent & Systems'], ['value', 'Value & Synergies']];
  let courses = [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const asI18n = (v) => (v && typeof v === 'object') ? { ...v } : { en: v || '', de: '', zh: '', cs: '' };
  const label = (v) => { const o = asI18n(v); return o.en || Object.values(o).find(Boolean) || ''; };
  const toast = (m, err) => { if (typeof window.adminToast === 'function') window.adminToast(m, err); else console.log(m); };

  // ---------- Modal ----------
  function modal(title, bodyEl, onSave) {
    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay';
    const box = document.createElement('div');
    box.className = 'cms-modal';
    box.innerHTML = `<div class="cms-modal-head"><h3>${esc(title)}</h3><button type="button" class="cms-modal-x" aria-label="Close">✕</button></div>`;
    const body = document.createElement('div');
    body.className = 'cms-modal-body';
    body.appendChild(bodyEl);
    const foot = document.createElement('div');
    foot.className = 'cms-modal-foot';
    foot.innerHTML = `<button type="button" class="btn btn-secondary cms-cancel">Cancel</button><button type="button" class="btn btn-primary cms-save">Save</button>`;
    box.appendChild(body); box.appendChild(foot); overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.querySelector('.cms-modal-x').addEventListener('click', close);
    foot.querySelector('.cms-cancel').addEventListener('click', close);
    foot.querySelector('.cms-save').addEventListener('click', async () => {
      const btn = foot.querySelector('.cms-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try { await onSave(); close(); } catch (e) { console.error(e); toast('Save failed.', true); btn.disabled = false; btn.textContent = 'Save'; }
    });
    return { close };
  }

  // ---------- Language-tabbed field group ----------
  // buildField(kind, i18nValue) -> { wrap, get() } where kind = 'input' | 'textarea' | 'wysiwyg'
  function buildLangField(kind, value) {
    const store = asI18n(value);
    let active = 'en';
    const wrap = document.createElement('div');
    wrap.className = 'cms-langfield';
    const tabs = document.createElement('div');
    tabs.className = 'cms-langtabs';
    const editorHost = document.createElement('div');

    let editors = {}; // lang -> element with .value or contenteditable

    const syncFromEditor = (lang) => {
      const ed = editors[lang];
      if (!ed) return;
      store[lang] = (kind === 'wysiwyg') ? ed.innerHTML : ed.value;
    };
    const render = () => {
      editorHost.innerHTML = '';
      LANGS.forEach(([code]) => {
        let ed;
        if (kind === 'wysiwyg') {
          const bar = document.createElement('div');
          bar.className = 'cms-wys-bar';
          bar.innerHTML = `
            <button type="button" data-cmd="bold"><b>B</b></button>
            <button type="button" data-cmd="italic"><i>I</i></button>
            <button type="button" data-cmd="formatBlock" data-val="h3">H</button>
            <button type="button" data-cmd="insertUnorderedList">• List</button>
            <button type="button" data-cmd="createLink">🔗</button>`;
          ed = document.createElement('div');
          ed.className = 'cms-wys';
          ed.contentEditable = 'true';
          ed.innerHTML = store[code] || '';
          bar.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => {
            e.preventDefault(); ed.focus();
            const cmd = b.dataset.cmd;
            if (cmd === 'createLink') { const u = prompt('Link URL:'); if (u) document.execCommand(cmd, false, u); }
            else document.execCommand(cmd, false, b.dataset.val || null);
          }));
          ed.addEventListener('input', () => { store[code] = ed.innerHTML; });
          const box = document.createElement('div');
          box.className = 'cms-wys-wrap' + (code === active ? '' : ' hidden');
          box.dataset.lang = code;
          box.appendChild(bar); box.appendChild(ed);
          editorHost.appendChild(box);
        } else {
          ed = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
          ed.className = 'form-control';
          if (kind === 'textarea') ed.rows = 2;
          ed.value = store[code] || '';
          ed.dataset.lang = code;
          if (code !== active) ed.classList.add('hidden');
          ed.addEventListener('input', () => { store[code] = ed.value; });
          editorHost.appendChild(ed);
        }
        editors[code] = ed;
      });
    };
    tabs.innerHTML = LANGS.map(([c, l]) => `<button type="button" class="cms-langtab${c === 'en' ? ' active' : ''}" data-lang="${c}">${l}</button>`).join('');
    tabs.querySelectorAll('.cms-langtab').forEach(t => t.addEventListener('click', () => {
      syncFromEditor(active);
      active = t.dataset.lang;
      tabs.querySelectorAll('.cms-langtab').forEach(x => x.classList.toggle('active', x === t));
      editorHost.querySelectorAll('[data-lang]').forEach(el => {
        const host = kind === 'wysiwyg' ? el : el;
        host.classList.toggle('hidden', host.dataset.lang !== active);
      });
    }));
    wrap.appendChild(tabs); wrap.appendChild(editorHost);
    render();
    return { wrap, get: () => { LANGS.forEach(([c]) => syncFromEditor(c)); return { ...store }; } };
  }

  const field = (labelText, node) => {
    const g = document.createElement('div');
    g.className = 'form-group';
    g.innerHTML = `<label class="form-label">${esc(labelText)}</label>`;
    g.appendChild(node);
    return g;
  };

  // ---------- Catalog render ----------
  function render() {
    const wrap = document.getElementById('courses-admin-list');
    if (!wrap) return;
    fetch('/api/courses').then(r => r.json()).then(list => {
      courses = list || [];
      wrap.innerHTML = '';
      if (!courses.length) {
        wrap.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:1.5rem;">No courses yet.</p>';
      }
      courses.forEach(c => wrap.appendChild(courseCard(c)));
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-secondary';
      add.style.cssText = 'align-self:flex-start;';
      add.textContent = '+ New course';
      add.addEventListener('click', () => editCourse(null));
      wrap.appendChild(add);
    }).catch(() => { wrap.innerHTML = '<p style="text-align:center;color:#B91C1C;padding:1.5rem;">Failed to load courses.</p>'; });
  }

  function courseCard(c) {
    const lessonCount = (c.modules || []).reduce((n, m) => n + (m.lessons || []).length, 0);
    const el = document.createElement('div');
    el.className = 'cms-course';
    const head = document.createElement('div');
    head.className = 'cms-course-head';
    head.innerHTML = `
      <div>
        <div class="cms-course-title">${esc(label(c.title))}</div>
        <div style="font-size:0.76rem;color:var(--text-secondary);">${(c.modules || []).length} modules · ${lessonCount} lessons · ${esc(c.gating || 'soft')} gating${c.certificateOnComplete ? ' · certificate' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.6rem;">
        <button type="button" class="cms-mini" data-act="edit-course">Edit</button>
        <label class="admin-toggle" title="Published"><input type="checkbox" ${c.published ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
      </div>`;
    head.querySelector('[data-act="edit-course"]').addEventListener('click', () => editCourse(c));
    head.querySelector('input').addEventListener('change', e => saveCourseMeta(c.id, { published: e.target.checked }).then(() => toast(`Course ${e.target.checked ? 'published' : 'unpublished'}.`)));
    el.appendChild(head);

    (c.modules || []).forEach(m => {
      const mod = document.createElement('div');
      mod.className = 'cms-module';
      const mh = document.createElement('div');
      mh.className = 'cms-module-name';
      mh.innerHTML = `<span>${esc(label(m.title))}</span><span style="font-weight:600;color:var(--text-dim);font-size:0.7rem;">${(m.lessons || []).length} lessons</span>
        <button type="button" class="cms-mini" data-act="edit-mod">Edit</button>
        <button type="button" class="cms-mini" data-act="add-lesson">+ Lesson</button>`;
      mh.querySelector('[data-act="edit-mod"]').addEventListener('click', () => editModule(c, m));
      mh.querySelector('[data-act="add-lesson"]').addEventListener('click', () => editLesson(c, m, null));
      mod.appendChild(mh);
      (m.lessons || []).forEach(l => {
        const qn = (l.quiz && l.quiz.questions ? l.quiz.questions.length : 0);
        const row = document.createElement('div');
        row.className = 'cms-lesson';
        row.innerHTML = `<span style="cursor:pointer;" class="cms-lesson-open">${esc(label(l.title))}</span>
          <span class="meta"><span class="cms-xp">+${l.xp || 0} XP</span> · <span>${qn} quiz Q</span>
          <button type="button" class="cms-mini" data-act="del-lesson">✕</button></span>`;
        row.querySelector('.cms-lesson-open').addEventListener('click', () => editLesson(c, m, l));
        row.querySelector('[data-act="del-lesson"]').addEventListener('click', () => {
          if (!confirm(`Delete lesson "${label(l.title)}"?`)) return;
          fetch(`/api/courses/${c.id}/lessons/${l.id}`, { method: 'DELETE' }).then(r => r.json()).then(() => { toast('Lesson deleted.'); render(); });
        });
        mod.appendChild(row);
      });
      el.appendChild(mod);
    });

    const addMod = document.createElement('div');
    addMod.style.cssText = 'padding:0.6rem 1rem;';
    addMod.innerHTML = `<button type="button" class="cms-mini">+ Add module</button>`;
    addMod.querySelector('button').addEventListener('click', () => editModule(c, null));
    el.appendChild(addMod);
    return el;
  }

  // ---------- Save helpers ----------
  function saveCourse(course) {
    return fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(course) }).then(r => r.json());
  }
  function saveCourseMeta(id, patch) { return saveCourse({ id, ...patch }); }
  function saveLesson(courseId, moduleId, lesson) {
    return fetch(`/api/courses/${courseId}/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moduleId, lesson }) }).then(r => r.json());
  }

  // ---------- Course editor ----------
  function editCourse(c) {
    const isNew = !c;
    c = c || { title: {}, description: {}, gating: 'soft', certificateOnComplete: true, xpPerLesson: 20, published: false, modules: [] };
    const form = document.createElement('div');
    const titleF = buildLangField('input', c.title);
    const descF = buildLangField('textarea', c.description);
    form.appendChild(field('Course title', titleF.wrap));
    form.appendChild(field('Description', descF.wrap));
    const row = document.createElement('div');
    row.className = 'cms-inline-row';
    row.innerHTML = `
      <div class="form-group"><label class="form-label">Gating</label>
        <select class="form-control form-select" id="cms-c-gating">
          <option value="soft"${c.gating === 'soft' ? ' selected' : ''}>Soft (nothing locked)</option>
          <option value="hard"${c.gating === 'hard' ? ' selected' : ''}>Hard (must pass to unlock)</option>
          <option value="none"${c.gating === 'none' ? ' selected' : ''}>None</option>
        </select></div>
      <div class="form-group"><label class="form-label">XP per lesson</label><input type="number" class="form-control" id="cms-c-xp" value="${c.xpPerLesson || 20}" min="0" step="5"></div>
      <div class="form-group"><label class="form-label">Certificate at 100%</label><select class="form-control form-select" id="cms-c-cert"><option value="yes"${c.certificateOnComplete !== false ? ' selected' : ''}>Yes</option><option value="no"${c.certificateOnComplete === false ? ' selected' : ''}>No</option></select></div>`;
    form.appendChild(row);
    modal(isNew ? 'New course' : 'Edit course', form, async () => {
      const payload = {
        id: c.id, title: titleF.get(), description: descF.get(),
        gating: form.querySelector('#cms-c-gating').value,
        xpPerLesson: parseInt(form.querySelector('#cms-c-xp').value, 10) || 20,
        certificateOnComplete: form.querySelector('#cms-c-cert').value === 'yes'
      };
      if (isNew) { payload.published = false; payload.modules = []; delete payload.id; }
      await saveCourse(payload); toast('Course saved.'); render();
    });
  }

  // ---------- Module editor ----------
  function editModule(c, m) {
    const isNew = !m;
    m = m || { title: {}, subtitle: {}, badge: {}, dimension: 'culture', lessons: [] };
    const form = document.createElement('div');
    const titleF = buildLangField('input', m.title);
    const subF = buildLangField('input', m.subtitle);
    const badgeF = buildLangField('input', m.badge);
    form.appendChild(field('Module title', titleF.wrap));
    form.appendChild(field('Subtitle', subF.wrap));
    form.appendChild(field('Badge label', badgeF.wrap));
    const dimSel = document.createElement('select');
    dimSel.className = 'form-control form-select';
    dimSel.innerHTML = DIMS.map(([v, l]) => `<option value="${v}"${m.dimension === v ? ' selected' : ''}>${l}</option>`).join('');
    form.appendChild(field('Dimension', dimSel));
    const footRow = document.createElement('div');
    if (!isNew) {
      footRow.innerHTML = `<button type="button" class="cms-mini danger" id="cms-del-mod">Delete module &amp; its lessons</button>`;
      footRow.querySelector('#cms-del-mod').addEventListener('click', () => {
        if (!confirm('Delete this module and all its lessons?')) return;
        const modules = (c.modules || []).filter(x => x.id !== m.id);
        saveCourse({ id: c.id, modules }).then(() => { toast('Module deleted.'); render(); document.querySelector('.cms-modal-overlay')?.remove(); });
      });
      form.appendChild(footRow);
    }
    modal(isNew ? 'New module' : 'Edit module', form, async () => {
      const modules = (c.modules || []).slice();
      const data = { title: titleF.get(), subtitle: subF.get(), badge: badgeF.get(), dimension: dimSel.value };
      if (isNew) {
        modules.push({ id: 'mod_' + Date.now(), order: modules.length + 1, lessons: [], ...data });
      } else {
        const idx = modules.findIndex(x => x.id === m.id);
        modules[idx] = { ...modules[idx], ...data };
      }
      await saveCourse({ id: c.id, modules }); toast('Module saved.'); render();
    });
  }

  // ---------- Lesson editor (with quiz) ----------
  function editLesson(c, m, l) {
    const isNew = !l;
    l = l || { title: {}, description: {}, body: {}, xp: c.xpPerLesson || 20, dimension: m.dimension || 'culture', playbookLink: '', prerequisite: null, quiz: { passMark: 70, questions: [] } };
    l.quiz = l.quiz || { passMark: 70, questions: [] };
    const form = document.createElement('div');
    const titleF = buildLangField('input', l.title);
    const descF = buildLangField('textarea', l.description);
    const bodyF = buildLangField('wysiwyg', l.body);
    form.appendChild(field('Lesson title', titleF.wrap));
    form.appendChild(field('Short description', descF.wrap));
    form.appendChild(field('Lesson content', bodyF.wrap));

    const row = document.createElement('div');
    row.className = 'cms-inline-row';
    // prerequisite options: all other lessons in this course
    const others = [];
    (c.modules || []).forEach(mm => (mm.lessons || []).forEach(ll => { if (ll.id !== l.id) others.push([ll.id, label(ll.title)]); }));
    row.innerHTML = `
      <div class="form-group"><label class="form-label">XP</label><input type="number" class="form-control" id="cms-l-xp" value="${l.xp || 20}" min="0" step="5"></div>
      <div class="form-group"><label class="form-label">Playbook link</label><input type="text" class="form-control" id="cms-l-pb" value="${esc(l.playbookLink || '')}" placeholder="/playbook.html#culture"></div>
      <div class="form-group"><label class="form-label">Prerequisite</label><select class="form-control form-select" id="cms-l-pre"><option value="">— none —</option>${others.map(([id, t]) => `<option value="${id}"${l.prerequisite === id ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
    form.appendChild(row);

    // Quiz editor
    const quizWrap = document.createElement('div');
    quizWrap.className = 'cms-quiz';
    const quizState = JSON.parse(JSON.stringify(l.quiz));
    const renderQuiz = () => {
      quizWrap.innerHTML = `<div class="cms-quiz-head"><strong>Quiz</strong>
        <label style="font-size:0.8rem;font-weight:600;">Pass mark %
        <input type="number" id="cms-q-pass" class="form-control" style="width:80px;display:inline-block;" value="${quizState.passMark || 70}" min="0" max="100"></label></div>`;
      (quizState.questions || []).forEach((q, qi) => {
        const qEl = document.createElement('div');
        qEl.className = 'cms-quiz-q';
        qEl.innerHTML = `<div class="cms-quiz-qtop"><span>Q${qi + 1} (editing ${'EN'})</span><button type="button" class="cms-mini danger" data-del>Remove</button></div>`;
        const qText = document.createElement('input');
        qText.className = 'form-control'; qText.placeholder = 'Question (English)';
        qText.value = asI18n(q.question).en || '';
        qText.addEventListener('input', () => { q.question = asI18n(q.question); q.question.en = qText.value; });
        qEl.appendChild(qText);
        (q.options || []).forEach((opt, oi) => {
          const optRow = document.createElement('div');
          optRow.className = 'cms-quiz-opt';
          optRow.innerHTML = `<input type="radio" name="correct-${qi}" ${q.correctIndex === oi ? 'checked' : ''}>`;
          const oInput = document.createElement('input');
          oInput.className = 'form-control'; oInput.placeholder = `Option ${oi + 1}`;
          oInput.value = asI18n(opt).en || '';
          oInput.addEventListener('input', () => { q.options[oi] = asI18n(q.options[oi]); q.options[oi].en = oInput.value; });
          optRow.querySelector('input[type=radio]').addEventListener('change', () => { q.correctIndex = oi; });
          optRow.appendChild(oInput);
          qEl.appendChild(optRow);
        });
        const addOpt = document.createElement('button');
        addOpt.type = 'button'; addOpt.className = 'cms-mini'; addOpt.textContent = '+ option';
        addOpt.addEventListener('click', () => { q.options = q.options || []; q.options.push({ en: '' }); renderQuiz(); });
        qEl.appendChild(addOpt);
        qEl.querySelector('[data-del]').addEventListener('click', () => { quizState.questions.splice(qi, 1); renderQuiz(); });
        quizWrap.appendChild(qEl);
      });
      const addQ = document.createElement('button');
      addQ.type = 'button'; addQ.className = 'cms-mini'; addQ.textContent = '+ Add question';
      addQ.style.marginTop = '0.5rem';
      addQ.addEventListener('click', () => { quizState.questions = quizState.questions || []; quizState.questions.push({ question: { en: '' }, options: [{ en: '' }, { en: '' }], correctIndex: 0 }); renderQuiz(); });
      quizWrap.appendChild(addQ);
      const pass = quizWrap.querySelector('#cms-q-pass');
      pass.addEventListener('input', () => { quizState.passMark = parseInt(pass.value, 10) || 0; });
    };
    renderQuiz();
    form.appendChild(field('Quiz (optional)', quizWrap));

    if (!isNew) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'cms-mini danger'; del.textContent = 'Delete lesson';
      del.addEventListener('click', () => {
        if (!confirm('Delete this lesson?')) return;
        fetch(`/api/courses/${c.id}/lessons/${l.id}`, { method: 'DELETE' }).then(r => r.json()).then(() => { toast('Lesson deleted.'); render(); document.querySelector('.cms-modal-overlay')?.remove(); });
      });
      form.appendChild(del);
    }

    modal(isNew ? 'New lesson' : 'Edit lesson', form, async () => {
      const lesson = {
        id: l.id, title: titleF.get(), description: descF.get(), body: bodyF.get(),
        xp: parseInt(form.querySelector('#cms-l-xp').value, 10) || 0,
        playbookLink: form.querySelector('#cms-l-pb').value,
        prerequisite: form.querySelector('#cms-l-pre').value || null,
        dimension: m.dimension || 'culture',
        quiz: quizState
      };
      if (isNew) delete lesson.id;
      await saveLesson(c.id, m.id, lesson); toast('Lesson saved.'); render();
    });
  }

  // ---------- Pages CMS (playbook & static pages) ----------
  function renderPages() {
    const wrap = document.getElementById('pages-admin-list');
    if (!wrap) return;
    fetch('/api/pages').then(r => r.json()).then(pages => {
      wrap.innerHTML = '';
      (pages || []).forEach(p => {
        const row = document.createElement('div');
        row.className = 'cms-row';
        const hasBody = p.body && Object.values(p.body).some(v => v && v.trim());
        row.innerHTML = `<div class="cms-row-main"><span class="cms-row-title">${esc(label(p.title) || p.slug)}</span>
          <span class="cms-row-sub">/${esc(p.slug)}${hasBody ? ' · has content' : ' · empty (static fallback)'}</span></div>
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <button type="button" class="cms-mini" data-edit>Edit</button>
            <label class="admin-toggle" title="Published"><input type="checkbox" ${p.published ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>`;
        row.querySelector('[data-edit]').addEventListener('click', () => editPage(p));
        row.querySelector('input').addEventListener('change', e => {
          fetch('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, published: e.target.checked }) })
            .then(r => r.json()).then(() => toast(`Page ${e.target.checked ? 'published' : 'unpublished'}.`));
        });
        wrap.appendChild(row);
      });
      if (!(pages || []).length) wrap.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:1.5rem;">No pages.</p>';
    }).catch(() => {});
  }

  function editPage(p) {
    const form = document.createElement('div');
    const titleF = buildLangField('input', p.title);
    const bodyF = buildLangField('wysiwyg', p.body);
    form.appendChild(field('Page title', titleF.wrap));
    form.appendChild(field('Page content', bodyF.wrap));
    const note = document.createElement('p');
    note.style.cssText = 'font-size:0.78rem;color:var(--text-secondary);margin:0.25rem 0 0;';
    note.textContent = 'When published with content, this replaces the live page body in the selected language. Leave empty to keep the original static page.';
    form.appendChild(note);
    modal(`Edit page — ${label(p.title) || p.slug}`, form, async () => {
      await fetch('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, title: titleF.get(), body: bodyF.get() }) }).then(r => r.json());
      toast('Page saved.'); renderPages();
    });
  }

  // ---------- Menus CMS (sidebar navigation + landing cards) ----------
  let menus = { sidebar: [], groups: [], landingCards: [] };
  const GROUPS = [['general', 'General'], ['portals', 'Portals'], ['resources', 'Resources']];
  const groupLabel = (k) => { const g = GROUPS.find(x => x[0] === k); return g ? g[1] : (k || '—'); };

  function saveMenus() {
    return fetch('/api/menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menus) })
      .then(r => r.json()).then(res => { if (res && res.menus) menus = res.menus; });
  }

  function loadMenus() {
    const wrap = document.getElementById('menus-admin-list');
    if (!wrap) return;
    fetch('/api/menus').then(r => r.json()).then(m => {
      menus = { sidebar: (m && m.sidebar) || [], groups: (m && m.groups) || [], landingCards: (m && m.landingCards) || [] };
      renderMenus();
    }).catch(() => { wrap.innerHTML = '<p style="text-align:center;color:#B91C1C;padding:1.5rem;">Failed to load menus.</p>'; });
  }

  function sectionHead(title, sub, mt) {
    const el = document.createElement('div');
    el.style.cssText = `display:flex;flex-direction:column;gap:0.1rem;margin:${mt || 0} 0 0.4rem;`;
    el.innerHTML = `<strong style="font-size:0.95rem;color:var(--te-dark-teal);">${esc(title)}</strong><span style="font-size:0.76rem;color:var(--text-secondary);">${esc(sub)}</span>`;
    return el;
  }

  function renderMenus() {
    const wrap = document.getElementById('menus-admin-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(sectionHead('Sidebar navigation', 'Labels, icons, order, and per-role visibility for the live sidebar.'));

    ['general', 'portals', 'resources'].forEach(gk => {
      const items = (menus.sidebar || []).filter(i => (i.group || 'general') === gk).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!items.length) return;
      const gl = document.createElement('div');
      gl.style.cssText = 'font-size:0.7rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);margin:0.5rem 0 0.1rem;';
      gl.textContent = groupLabel(gk);
      wrap.appendChild(gl);
      items.forEach((it, idx) => wrap.appendChild(sidebarRow(it, items, idx)));
    });

    const addLink = document.createElement('button');
    addLink.type = 'button'; addLink.className = 'btn btn-secondary';
    addLink.style.cssText = 'align-self:flex-start;margin-top:0.5rem;';
    addLink.textContent = '+ Add custom link';
    addLink.addEventListener('click', () => editMenuItem(null));
    wrap.appendChild(addLink);

    wrap.appendChild(sectionHead('Landing role cards', 'Cards shown on the demo home page.', '1.25rem'));
    const cards = (menus.landingCards || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!cards.length) {
      const none = document.createElement('p');
      none.style.cssText = 'font-size:0.8rem;color:var(--text-dim);'; none.textContent = 'No landing cards defined.';
      wrap.appendChild(none);
    }
    cards.forEach(card => wrap.appendChild(landingRow(card)));
  }

  function sidebarRow(it, siblings, idx) {
    const row = document.createElement('div');
    row.className = 'cms-row';
    const scope = it.roleScope && it.roleScope !== 'all' ? ' · ' + it.roleScope : '';
    row.innerHTML = `<div class="cms-row-main"><span class="cms-row-title">${esc(it.icon || '')} ${esc(label(it.label) || it.href || it.id)}${it.custom ? ' <span style="font-size:0.6rem;color:var(--te-orange);font-weight:800;">CUSTOM</span>' : ''}</span>
        <span class="cms-row-sub">${esc(it.href || '')}${esc(scope)}</span></div>
      <div style="display:flex;align-items:center;gap:0.4rem;">
        <button type="button" class="cms-mini" data-up ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="cms-mini" data-down ${idx === siblings.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="cms-mini" data-edit>Edit</button>
        ${it.custom ? '<button type="button" class="cms-mini danger" data-del>✕</button>' : ''}
        <label class="admin-toggle" title="Visible"><input type="checkbox" ${it.visible !== false ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
      </div>`;
    row.querySelector('[data-edit]').addEventListener('click', () => editMenuItem(it));
    row.querySelector('[data-up]').addEventListener('click', () => moveItem(siblings, idx, -1));
    row.querySelector('[data-down]').addEventListener('click', () => moveItem(siblings, idx, 1));
    const del = row.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => {
      if (!confirm('Delete this custom link?')) return;
      menus.sidebar = menus.sidebar.filter(x => x.id !== it.id);
      saveMenus().then(() => { toast('Link deleted.'); renderMenus(); });
    });
    row.querySelector('input').addEventListener('change', e => {
      it.visible = e.target.checked;
      saveMenus().then(() => toast(`"${label(it.label) || it.id}" ${e.target.checked ? 'shown' : 'hidden'}.`));
    });
    return row;
  }

  function moveItem(siblings, idx, dir) {
    const a = siblings[idx], b = siblings[idx + dir];
    if (!a || !b) return;
    const ao = a.order || 0, bo = b.order || 0;
    a.order = bo; b.order = ao;
    saveMenus().then(() => renderMenus());
  }

  function editMenuItem(it) {
    const isNew = !it;
    it = it || { id: 'nav_custom_' + Date.now(), group: 'portals', label: {}, icon: '🔗', href: '', order: 999, visible: true, roleScope: 'all', custom: true };
    const form = document.createElement('div');
    const labelF = buildLangField('input', it.label);
    form.appendChild(field('Label', labelF.wrap));
    const row = document.createElement('div');
    row.className = 'cms-inline-row';
    row.innerHTML = `
      <div class="form-group"><label class="form-label">Icon (emoji)</label><input type="text" class="form-control" id="cms-m-icon" value="${esc(it.icon || '')}"></div>
      <div class="form-group"><label class="form-label">Group</label><select class="form-control form-select" id="cms-m-group">${GROUPS.map(([v, l]) => `<option value="${v}"${(it.group || 'general') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
    form.appendChild(row);
    const row2 = document.createElement('div');
    row2.className = 'cms-inline-row';
    row2.innerHTML = `
      <div class="form-group"><label class="form-label">Link (href)</label><input type="text" class="form-control" id="cms-m-href" value="${esc(it.href || '')}" placeholder="/playbook.html"></div>
      <div class="form-group"><label class="form-label">Role scope</label><input type="text" class="form-control" id="cms-m-scope" value="${esc(it.roleScope || 'all')}" placeholder="all or admin,pmo,employee"></div>`;
    form.appendChild(row2);
    if (!isNew && !it.custom) {
      const note = document.createElement('p');
      note.style.cssText = 'font-size:0.76rem;color:var(--text-secondary);margin:0.25rem 0 0;';
      note.textContent = 'Built-in link — its href stays intact on the live sidebar; label, icon, group, order, and visibility are applied.';
      form.appendChild(note);
    }
    modal(isNew ? 'New custom link' : 'Edit navigation item', form, async () => {
      it.label = labelF.get();
      it.icon = form.querySelector('#cms-m-icon').value.trim();
      it.group = form.querySelector('#cms-m-group').value;
      it.href = form.querySelector('#cms-m-href').value.trim();
      it.roleScope = form.querySelector('#cms-m-scope').value.trim() || 'all';
      if (isNew) { it.custom = true; it.visible = true; menus.sidebar.push(it); }
      await saveMenus(); toast('Navigation saved.'); renderMenus();
    });
  }

  function landingRow(card) {
    const row = document.createElement('div');
    row.className = 'cms-row';
    row.innerHTML = `<div class="cms-row-main"><span class="cms-row-title">${esc(card.icon || '')} ${esc(label(card.title) || card.id)}</span>
        <span class="cms-row-sub">${esc(label(card.desc) || '')}</span></div>
      <div style="display:flex;align-items:center;gap:0.4rem;">
        <button type="button" class="cms-mini" data-edit>Edit</button>
        <label class="admin-toggle" title="Visible"><input type="checkbox" ${card.visible !== false ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
      </div>`;
    row.querySelector('[data-edit]').addEventListener('click', () => editLandingCard(card));
    row.querySelector('input').addEventListener('change', e => {
      card.visible = e.target.checked;
      saveMenus().then(() => toast(`Card ${e.target.checked ? 'shown' : 'hidden'}.`));
    });
    return row;
  }

  function editLandingCard(card) {
    const form = document.createElement('div');
    const titleF = buildLangField('input', card.title);
    const descF = buildLangField('textarea', card.desc);
    form.appendChild(field('Card title', titleF.wrap));
    form.appendChild(field('Card description', descF.wrap));
    const iconG = document.createElement('div');
    iconG.className = 'form-group';
    iconG.innerHTML = `<label class="form-label">Icon (emoji)</label><input type="text" class="form-control" id="cms-lc-icon" value="${esc(card.icon || '')}">`;
    form.appendChild(iconG);
    modal(`Edit card — ${label(card.title) || card.id}`, form, async () => {
      card.title = titleF.get();
      card.desc = descF.get();
      card.icon = form.querySelector('#cms-lc-icon').value.trim();
      await saveMenus(); toast('Card saved.'); renderMenus();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Own the Courses + Pages + Menus panels (replaces admin.js's read-only renders)
    render();
    renderPages();
    loadMenus();
  });
  window.reloadCoursesCms = render;
  window.reloadMenusCms = loadMenus;
})();
