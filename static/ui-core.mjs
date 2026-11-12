/**
 * Lunar Link Planner - UI Core Module
 * Provides the global window.LLP.UI API and ES module exports.
 * Builds the required DOM scaffold inside init(root).
 */

const PANEL_NAMES = ['planets', 'routes', 'layers', 'settings'];
const PANEL_TITLES = {
  planets: 'Celestial Bodies',
  routes: 'Route Planner',
  layers: 'Map Layers',
  settings: 'Settings'
};

const LAYER_DEFAULTS = [
  { id: 'terrain', name: 'Terrain', defaultOn: true, group: 'base' },
  { id: 'craters', name: 'Craters', defaultOn: false, group: 'base' },
  { id: 'mountains', name: 'Mountains', defaultOn: false, group: 'base' },
  { id: 'atmosphere', name: 'Atmosphere', defaultOn: true, group: 'base' },
  { id: 'clouds', name: 'Clouds', defaultOn: false, group: 'base' },
  { id: 'orbits', name: 'Orbits', defaultOn: true, group: 'overlay' },
  { id: 'labels', name: 'Labels', defaultOn: true, group: 'overlay' },
  { id: 'grid', name: 'Grid', defaultOn: false, group: 'overlay' },
  { id: 'rings', name: 'Rings', defaultOn: false, group: 'overlay' }
];

const PLANET_GROUPS = [
  { key: 'Rocky Planets', label: 'Rocky Planets' },
  { key: 'Gas Giants', label: 'Gas Giants' },
  { key: 'Ice Giants', label: 'Ice Giants' },
  { key: 'Moons', label: 'Moons' },
  { key: 'Dwarf', label: 'Dwarf Planets' }
];

export const UI = {
  root: null,
  _state: {
    layers: new Map(),
    settings: {
      mode: 'overview',
      quality: 'high',
      units: 'km',
      autoRotate: false
    },
    hintTimer: null
  },

  /**
   * Initialize the UI: build the scaffold inside root and expose on window.LLP.UI.
   * @param {HTMLElement} root
   */
  init(root) {
    this.root = root;
    this._buildScaffold();
    this._startHintTimer();
    if (typeof window !== 'undefined') {
      window.LLP = window.LLP || {};
      window.LLP.UI = this;
    }
  },

  _buildScaffold() {
    const doc = this.root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    // Canvas
    const canvas = doc.createElement('canvas');
    canvas.id = 'llp-canvas';
    this.root.appendChild(canvas);

    // Header
    const header = doc.createElement('header');
    header.id = 'llp-header';
    const brand = doc.createElement('div');
    brand.id = 'llp-brand';
    brand.textContent = 'Lunar Link Planner';
    const tagline = doc.createElement('div');
    tagline.id = 'llp-tagline';
    tagline.textContent = 'Deep-Space Route Analysis · NASA-Grade Visualization';
    header.appendChild(brand);
    header.appendChild(tagline);
    this.root.appendChild(header);

    // Breadcrumb
    const breadcrumb = doc.createElement('nav');
    breadcrumb.id = 'llp-breadcrumb';
    this.root.appendChild(breadcrumb);

    // Panels
    PANEL_NAMES.forEach(name => {
      const panel = doc.createElement('aside');
      panel.className = 'llp-panel hidden';
      panel.setAttribute('data-panel', name);
      // Keep the panel within the viewport (matches the celestial view window
      // height, top:6rem + 1.5rem bottom). min-height:0 lets the flex body
      // actually shrink and scroll instead of overflowing the panel.
      panel.style.minHeight = '0';
      panel.style.maxHeight = 'calc(100vh - 8rem)';
      const ph = doc.createElement('div');
      ph.className = 'llp-panel-header';
      ph.textContent = PANEL_TITLES[name];
      const pb = doc.createElement('div');
      pb.className = 'llp-panel-body';
      // Spec: side panels must be fully scrollable and match the celestial
      // view window length. .llp-panel is a flex column (overflow:hidden);
      // the body only scrolls reliably if it is allowed to shrink and grow
      // into the remaining space. min-height:0 defeats the default
      // min-height:auto flex-item floor that otherwise prevents scrolling.
      pb.style.flex = '1 1 auto';
      pb.style.minHeight = '0';
      pb.style.overflowY = 'auto';
      pb.style.WebkitOverflowScrolling = 'touch';
      panel.appendChild(ph);
      panel.appendChild(pb);
      this.root.appendChild(panel);
    });

    // Search
    const search = doc.createElement('input');
    search.id = 'llp-search';
    search.type = 'text';
    search.placeholder = 'Search bodies, cities, coordinates…';
    this.root.appendChild(search);

    // Status
    const status = doc.createElement('div');
    status.id = 'llp-status';
    status.textContent = 'READY';
    this.root.appendChild(status);

    // Toasts
    const toasts = doc.createElement('div');
    toasts.id = 'llp-toasts';
    toasts.setAttribute('aria-live', 'polite');
    this.root.appendChild(toasts);

    // Hint
    const hint = doc.createElement('div');
    hint.id = 'llp-hint';
    hint.textContent = 'Shortcuts: [P]lanets  [R]outes  [L]ayers  [S]ettings  [Esc] Close';
    this.root.appendChild(hint);

    // Pre-build layers, routes, settings panels
    const layerState = new Map();
    LAYER_DEFAULTS.forEach(d => layerState.set(d.id, d.defaultOn));
    this._state.layers = layerState;

    this.buildLayersPanel(LAYER_DEFAULTS, id => this._state.layers.get(id), (id, on) => {
      this._state.layers.set(id, on);
    });
    this.buildRoutesPanel();
    this.buildSettingsPanel();
  },

  _startHintTimer() {
    if (this._state.hintTimer) clearTimeout(this._state.hintTimer);
    this._state.hintTimer = setTimeout(() => {
      const hint = this.root.querySelector('#llp-hint');
      if (hint) hint.classList.add('hidden');
    }, 8000);
  },

  /**
   * Show a specific panel.
   * @param {'planets'|'routes'|'layers'|'settings'} name
   */
  showPanel(name) {
    const panel = this.root.querySelector(`.llp-panel[data-panel="${name}"]`);
    if (panel) panel.classList.remove('hidden');
  },

  /**
   * Hide a specific panel.
   * @param {'planets'|'routes'|'layers'|'settings'} name
   */
  hidePanel(name) {
    const panel = this.root.querySelector(`.llp-panel[data-panel="${name}"]`);
    if (panel) panel.classList.add('hidden');
  },

  /**
   * Toggle a specific panel's visibility.
   * @param {'planets'|'routes'|'layers'|'settings'} name
   */
  togglePanel(name) {
    const panel = this.root.querySelector(`.llp-panel[data-panel="${name}"]`);
    if (panel) panel.classList.toggle('hidden');
  },

  /**
   * Render the breadcrumb navigation.
   * @param {string[]} arr
   */
  renderBreadcrumb(arr) {
    const breadcrumb = this.root.querySelector('#llp-breadcrumb');
    if (!breadcrumb) return;
    const doc = breadcrumb.ownerDocument || (typeof document !== 'undefined' ? document : null);
    breadcrumb.innerHTML = '';
    if (!doc) return;
    arr.forEach((item, i) => {
      const span = doc.createElement('span');
      span.className = 'llp-breadcrumb-item';
      span.textContent = item;
      breadcrumb.appendChild(span);
      if (i < arr.length - 1) {
        const sep = doc.createElement('span');
        sep.className = 'llp-breadcrumb-sep';
        sep.textContent = '/';
        breadcrumb.appendChild(sep);
      }
    });
  },

  /**
   * Show a toast notification.
   * @param {string} msg
   * @param {'info'|'warn'|'error'} [kind='info']
   */
  showToast(msg, kind = 'info') {
    const toastsContainer = this.root.querySelector('#llp-toasts');
    if (!toastsContainer) return;
    const doc = toastsContainer.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const existing = toastsContainer.querySelectorAll('.llp-toast');
    if (existing.length >= 3) {
      existing[0].remove();
    }

    const toast = doc.createElement('div');
    toast.className = `llp-toast ${kind}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = msg;
    toastsContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3500);
  },

  /**
   * Update the status bar HTML.
   * @param {string} html
   */
  setStatus(html) {
    const status = this.root.querySelector('#llp-status');
    if (status) status.innerHTML = html;
  },

  /**
   * Build the planet list panel, grouped by type.
   * @param {Array<{id:string, name:string, type:string}>} bodies
   * @param {(id:string)=>void} onSelect
   */
  buildPlanetList(bodies, onSelect) {
    const panelBody = this.root.querySelector('[data-panel="planets"] .llp-panel-body');
    if (!panelBody) return;
    const doc = panelBody.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    panelBody.innerHTML = '';
    const groups = {};
    PLANET_GROUPS.forEach(g => { groups[g.key] = []; });
    bodies.forEach(body => {
      if (groups[body.type]) groups[body.type].push(body);
    });

    PLANET_GROUPS.forEach(g => {
      const items = groups[g.key];
      if (!items || items.length === 0) return;
      const group = doc.createElement('div');
      group.className = 'llp-planet-group';
      const label = doc.createElement('div');
      label.className = 'llp-group-label';
      label.textContent = g.label;
      group.appendChild(label);
      items.forEach(body => {
        const btn = doc.createElement('button');
        btn.className = 'llp-toggle';
        btn.textContent = body.name;
        btn.addEventListener('click', () => onSelect(body.id));
        group.appendChild(btn);
      });
      panelBody.appendChild(group);
    });
  },

  /**
   * Build the layers toggle panel.
   * @param {Array<{id:string, name:string, defaultOn:boolean, group:string}>} defs
   * @param {(id:string)=>boolean} isOn
   * @param {(id:string, on:boolean)=>void} onToggle
   */
  buildLayersPanel(defs, isOn, onToggle) {
    const panelBody = this.root.querySelector('[data-panel="layers"] .llp-panel-body');
    if (!panelBody) return;
    const doc = panelBody.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    panelBody.innerHTML = '';
    defs.forEach(def => {
      const btn = doc.createElement('button');
      btn.className = 'llp-toggle';
      btn.setAttribute('data-layer', def.id);
      btn.setAttribute('aria-pressed', isOn(def.id) ? 'true' : 'false');
      btn.textContent = def.name;
      btn.addEventListener('click', () => {
        const newState = !isOn(def.id);
        btn.setAttribute('aria-pressed', newState ? 'true' : 'false');
        onToggle(def.id, newState);
      });
      panelBody.appendChild(btn);
    });
  },

  /**
   * Build the route planning panel.
   */
  buildRoutesPanel() {
    const panelBody = this.root.querySelector('[data-panel="routes"] .llp-panel-body');
    if (!panelBody) return;
    const doc = panelBody.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    panelBody.innerHTML = '';

    const makeField = (id, label) => {
      const wrap = doc.createElement('div');
      wrap.className = 'llp-route-field';
      const lbl = doc.createElement('label');
      lbl.className = 'llp-field-label';
      lbl.textContent = label;
      const row = doc.createElement('div');
      row.className = 'llp-field-row';
      const input = doc.createElement('input');
      input.type = 'text';
      input.id = id;
      input.placeholder = 'Search body…';
      const clear = doc.createElement('button');
      clear.id = id === 'llp-route-from' ? 'llp-route-from-clear' : 'llp-route-to-clear';
      clear.className = 'llp-clear-btn';
      clear.type = 'button';
      clear.textContent = '×';
      clear.setAttribute('aria-label', `Clear ${label}`);
      clear.addEventListener('click', () => { input.value = ''; input.focus(); });
      row.appendChild(input);
      row.appendChild(clear);
      wrap.appendChild(lbl);
      wrap.appendChild(row);
      return wrap;
    };

    panelBody.appendChild(makeField('llp-route-from', 'From'));
    panelBody.appendChild(makeField('llp-route-to', 'To'));

    const computeBtn = doc.createElement('button');
    computeBtn.id = 'llp-route-compute';
    computeBtn.className = 'llp-toggle llp-route-primary';
    computeBtn.type = 'button';
    computeBtn.textContent = 'Compute';
    panelBody.appendChild(computeBtn);

    const results = doc.createElement('div');
    results.id = 'llp-route-results';
    results.className = 'llp-route-results';

    ['Trajectory', 'Delta-V Budget', 'Duration'].forEach(title => {
      const sec = doc.createElement('div');
      sec.className = 'llp-route-section';
      const lbl = doc.createElement('div');
      lbl.className = 'llp-field-label';
      lbl.textContent = title;
      const val = doc.createElement('div');
      val.className = 'llp-route-section-value';
      val.textContent = '—';
      sec.appendChild(lbl);
      sec.appendChild(val);
      results.appendChild(sec);
    });

    panelBody.appendChild(results);
  },

  /**
   * Build the settings panel.
   */
  buildSettingsPanel() {
    const panelBody = this.root.querySelector('[data-panel="settings"] .llp-panel-body');
    if (!panelBody) return;
    const doc = panelBody.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    panelBody.innerHTML = '';

    const makeGroup = (label, setting, options, currentValue) => {
      const wrap = doc.createElement('div');
      wrap.className = 'llp-settings-group';
      const lbl = doc.createElement('div');
      lbl.className = 'llp-field-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const row = doc.createElement('div');
      row.className = 'llp-settings-row';
      options.forEach(opt => {
        const btn = doc.createElement('button');
        btn.className = 'llp-toggle';
        btn.type = 'button';
        btn.setAttribute('data-setting', setting);
        btn.setAttribute('data-value', opt.value);
        btn.setAttribute('aria-pressed', opt.value === currentValue ? 'true' : 'false');
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          row.querySelectorAll('.llp-toggle').forEach(b => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          this._state.settings[setting] = opt.value;
        });
        row.appendChild(btn);
      });
      wrap.appendChild(row);
      return wrap;
    };

    panelBody.appendChild(makeGroup('Mode', 'mode', [
      { value: 'overview', label: 'Overview' },
      { value: 'true-scale', label: 'True Scale' }
    ], this._state.settings.mode));

    panelBody.appendChild(makeGroup('Quality', 'quality', [
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' }
    ], this._state.settings.quality));

    panelBody.appendChild(makeGroup('Units', 'units', [
      { value: 'km', label: 'km' },
      { value: 'au', label: 'AU' }
    ], this._state.settings.units));

    const autoWrap = doc.createElement('div');
    autoWrap.className = 'llp-settings-group';
    const autoBtn = doc.createElement('button');
    autoBtn.className = 'llp-toggle';
    autoBtn.type = 'button';
    autoBtn.setAttribute('data-setting', 'auto-rotate');
    autoBtn.setAttribute('aria-pressed', this._state.settings.autoRotate ? 'true' : 'false');
    autoBtn.textContent = 'Auto-rotate';
    autoBtn.addEventListener('click', () => {
      const next = autoBtn.getAttribute('aria-pressed') !== 'true';
      autoBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      this._state.settings.autoRotate = next;
    });
    autoWrap.appendChild(autoBtn);
    panelBody.appendChild(autoWrap);
  },

  /**
   * Format a number with thousand separators.
   * @param {number} n
   * @param {number} [decimals=0]
   * @returns {string}
   */
  formatNumber(n, decimals = 0) {
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
};

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.UI = UI;
}

export default UI;
