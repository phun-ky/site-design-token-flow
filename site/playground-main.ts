import '../src/styles/index.css';
import './playground.css';

import { Arclace } from '@phun-ky/arclace';

import {
  checkTokenText,
  countTokens,
  lineOfProblem,
  type CheckedProblem,
  type CheckedTokens
} from '../src/app/check-tokens';
import type { ConvertedTokens } from '../src/app/convert-tokens';
import { loadFonts } from '../src/app/fonts';
import { formatHtml } from '../src/app/format-html';
import { mountHeader } from '../src/app/header';
import type { Colorize } from '../src/app/highlight';
import {
  browserStorage,
  chooseFlowTokens,
  readSaved,
  writeSaved,
  type Preset
} from '../src/app/saved-tokens';
import { mountSidebarCollapse } from '../src/app/sidebar';
import { formatBytes, refuseTokenFile } from '../src/app/token-file';
import bundledTokens from '../src/assets/data/design-tokens.tokens.json';
import {
  createDesignTokenElement,
  fitWrappedValues,
  FlatDesignToken,
  getDesignTokenKind,
  getFontFaces,
  toCssValue,
  renderDesignToken,
  type DTCGDocument
} from '../src/tokens';
import type { SetUse } from '../src/tokens/tokens-studio';

import { runImportWizard } from './import-wizard';
import { mountNewTokenForm } from './new-token-form';
import showcaseTokens from './showcase.tokens.json';
import type { CheckRequest, CheckResponse } from './validate-worker';

const PRESETS: Record<Exclude<Preset, 'custom'>, unknown> = {
  showcase: showcaseTokens,
  bundled: bundledTokens
};
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const sourceEl = $<HTMLTextAreaElement>('#source');
const sourceBoxEl = $<HTMLElement>('.demo-source');
const sourceCodeEl = $<HTMLElement>('.demo-source-code');
const presetEls = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="preset"]')
];
const bundledCountEl = $<HTMLSpanElement>('#bundled-count');
const customCountEl = $<HTMLSpanElement>('#custom-count');
const prefixEl = $<HTMLInputElement>('#prefix');
const filterEl = $<HTMLInputElement>('#filter');
const problemsEl = $<HTMLElement>('#error');
const problemsTitleEl = $<HTMLSpanElement>('#problems-title');
const problemsListEl = problemsEl.querySelector('ul') as HTMLUListElement;
const flowLinkEl = $<HTMLParagraphElement>('#to-flow');
const flowHintEl = $<HTMLSpanElement>('#to-flow-hint');
const savedEl = $<HTMLSpanElement>('#saved');
const checkingEl = $<HTMLSpanElement>('#checking');
const dropEl = $<HTMLElement>('#drop');
const loadFileEl = $<HTMLButtonElement>('#load-file');
const fileEl = $<HTMLInputElement>('#file');
const fileStatusEl = $<HTMLDivElement>('#file-status');
const importEl = $<HTMLDialogElement>('#import');
const exportEl = $<HTMLDialogElement>('#export');
const announceEl = $<HTMLParagraphElement>('#announce');
const groupsEl = $<HTMLDivElement>('#groups');
const countEl = $<HTMLSpanElement>('#count');
const detailsEl = $<HTMLElement>('#details');
// Arclace adds its SVG overlay to #groups, so the pills are rendered into a list next to it
const arclace = new Arclace({
  container: groupsEl,
  defaults: {
    arrow: 'end',
    strokeWidth: 1.5,
    className: 'dtf-line demo-relation'
  }
});
const listEl = document.createElement('div');

groupsEl.append(listEl);
// Fonts change the widths of wrapped values once they have loaded
document.fonts.addEventListener('loadingdone', () => fitWrappedValues(listEl));

let tokens: FlatDesignToken[] = [];
let problems: CheckedProblem[] = [];
let selectedId: string | null = null;

// Per-viewer convenience only: the preset and the JSON you edit stay in this
// browser, and the flow view shows your tokens from there
const store = browserStorage();
const escape = (value: string) =>
  value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;
const preset = (): Preset =>
  (presetEls.find((input) => input.checked)?.value as Preset) ?? 'showcase';
const setPreset = (value: Preset) =>
  presetEls.forEach((input) => (input.checked = input.value === value));

// Syntax highlighting, once Shiki has loaded; plain text until then
let colorize: Colorize | null = null;

/** A code block: highlighted when Shiki has loaded, plain text before */
const codeBlock = (code: string, lang: 'json' | 'html', className = '') =>
  colorize
    ? colorize(code, lang, { className })
    : `<pre${className ? ` class="${className}"` : ''}>${escape(code)}</pre>`;
const json = (value: unknown) =>
  codeBlock(JSON.stringify(value, null, 2), 'json');
// Above this many lines, highlighting takes long enough to slow typing, so
// the editor shows plain text while typing and highlights after a pause
const EDITOR_LINES_HIGHLIGHTED_AT_ONCE = 1000;

let sourceTimer: number | undefined;

const highlightSource = () => {
  if (!colorize) return;

  // A last empty line needs a character, or the copy ends a line short
  // Hidden from assistive technology, so not a Tab stop either
  sourceCodeEl.innerHTML = colorize(`${sourceEl.value}\n`, 'json', {
    focusable: false
  });
  sourceCodeEl.scrollTop = sourceEl.scrollTop;
  sourceCodeEl.scrollLeft = sourceEl.scrollLeft;
  sourceBoxEl.classList.add('is-highlighted');
  sourceBoxEl.classList.remove('is-stale');
};
const updateSource = () => {
  window.clearTimeout(sourceTimer);

  if (!colorize) return;

  if (sourceEl.value.split('\n').length < EDITOR_LINES_HIGHLIGHTED_AT_ONCE)
    return highlightSource();

  sourceBoxEl.classList.add('is-stale');
  sourceTimer = window.setTimeout(highlightSource, 300);
};

sourceEl.addEventListener('scroll', () => {
  sourceCodeEl.scrollTop = sourceEl.scrollTop;
  sourceCodeEl.scrollLeft = sourceEl.scrollLeft;
});

// Checking runs in a Web Worker, so a large file doesn't block the page
// (#109); where workers are blocked, it runs here
const worker = (() => {
  try {
    return new Worker(new URL('./validate-worker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    return null;
  }
})();
const waiting = new Map<number, (response: CheckResponse) => void>();

let lastRequest = 0;

worker?.addEventListener('message', (event: MessageEvent<CheckResponse>) => {
  waiting.get(event.data.id)?.(event.data);
  waiting.delete(event.data.id);
});

/** Sends a request to the worker */
const ask = (request: CheckRequest): Promise<CheckResponse> =>
  new Promise((resolve) => {
    waiting.set(request.id, resolve);
    worker?.postMessage(request);
  });
/** Checks token JSON, in the worker when there is one */
const check = async (text: string): Promise<CheckedTokens> => {
  if (!worker) return checkTokenText(text);

  const response = await ask({ id: (lastRequest += 1), kind: 'check', text });

  return response as CheckedTokens;
};
/** Reads a token file, converting a Tokens Studio file, in the worker */
const convert = async (
  text: string,
  choice: { theme?: string; uses?: Record<string, SetUse> } = {}
): Promise<ConvertedTokens | null> => {
  // Without a worker, the converter loads here, when first needed
  if (!worker)
    return (await import('../src/app/convert-tokens')).convertTokenText(
      text,
      choice
    );

  const response = await ask({
    id: (lastRequest += 1),
    kind: 'convert',
    text,
    ...choice
  });

  return response.kind === 'convert' ? response.converted : null;
};
/** Says something to screen readers, and anyone reading the status */
const announce = (message: string) => {
  announceEl.textContent = '';
  requestAnimationFrame(() => (announceEl.textContent = message));
};
/**
 * Shows that the tokens are being checked. It appears only when checking
 * takes more than 300 ms (a CSS animation delay), so typing doesn't flicker.
 */
const showChecking = (text: string | null) => {
  checkingEl.textContent = text
    ? `Checking ${plural(countTokens(text), 'token')}`
    : '';
};
/** Moves the editor to a line, and selects it */
const goToLine = (line: number) => {
  const lines = sourceEl.value.split('\n');
  const start = lines
    .slice(0, line - 1)
    .reduce((sum, text) => sum + text.length + 1, 0);
  const lineHeight = parseFloat(getComputedStyle(sourceEl).lineHeight) || 18;

  sourceEl.focus();
  sourceEl.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  sourceEl.scrollTop = Math.max(0, (line - 3) * lineHeight);
};
/** Lists the problems in the sidebar, each moving the editor to its line */
const showProblems = () => {
  problemsEl.hidden = problems.length === 0;
  problemsTitleEl.textContent = `${plural(problems.length, 'problem')} in the tokens`;
  problemsListEl.replaceChildren(
    ...problems.map((problem) => {
      const item = document.createElement('li');
      const line = lineOfProblem(sourceEl.value, problem);

      if (line === null) {
        item.textContent = problem.message;

        return item;
      }

      const button = document.createElement('button');
      const where = document.createElement('span');

      button.type = 'button';
      button.className = 'demo-problem';
      where.className = 'demo-problem-line';
      where.textContent = `Line ${line}`;
      button.append(where, problem.message);
      button.addEventListener('click', () => goToLine(line));
      item.append(button);

      return item;
    })
  );
};
/** What the sidebar says about your tokens, and whether they are saved */
const showSaved = () => {
  const saved = readSaved(store);

  customCountEl.textContent = !store
    ? 'Your browser blocks storage, so they are not kept'
    : saved.custom === undefined
      ? 'None yet: type, paste or load a file'
      : 'Saved in this browser';
  savedEl.textContent =
    preset() !== 'custom'
      ? 'Editing it starts your own tokens'
      : store
        ? 'Saved in this browser'
        : 'Not saved: your browser blocks storage';
};
// "Show in the flow", once you have tokens of your own without problems
const showFlowLink = () => {
  const flow = chooseFlowTokens(store, false);

  flowLinkEl.hidden = flow.kind !== 'yours';
  flowHintEl.hidden = flow.kind !== 'yours' || flow.latest;
};
/** Shows checked tokens: the pills, the problems and what is saved */
const apply = (checked: CheckedTokens, text: string) => {
  tokens = checked.tokens;
  problems = checked.problems;
  // Fonts the tokens describe; the Content Security Policy only allows
  // files from the site itself
  loadFonts(getFontFaces(tokens));

  // Your edits without problems: the version the flow view falls back to
  // while you fix a later one
  if (
    problems.length === 0 &&
    tokens.length > 0 &&
    readSaved(store).custom === text
  )
    writeSaved(store, { valid: text });

  showProblems();
  render();
  showSaved();
  showFlowLink();
};

let lastParse = 0;

// Checks the editor's text and shows the result; a newer edit wins
const parse = async () => {
  const run = (lastParse += 1);
  const text = sourceEl.value;

  showChecking(text);

  const checked = await check(text);

  if (run !== lastParse) return;

  showChecking(null);
  apply(checked, text);
};
const render = () => {
  const query = filterEl.value.trim().toLowerCase();
  const prefix = prefixEl.value;
  const visible = tokens.filter(
    (token) =>
      !query ||
      token.name.toLowerCase().includes(query) ||
      token.$type.toLowerCase().includes(query)
  );
  const groups = new Map<string, FlatDesignToken[]>();

  visible.forEach((token) => {
    const key =
      token.path.slice(0, Math.min(2, token.path.length - 1)).join(' / ') ||
      '(root)';

    groups.set(key, [...(groups.get(key) ?? []), token]);
  });

  countEl.textContent = `${visible.length} of ${tokens.length}`;
  listEl.replaceChildren(
    ...[...groups].map(([name, groupTokens]) => {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      const list = document.createElement('div');

      section.className = 'demo-group';
      heading.textContent = name;
      list.className = 'tokens';
      groupTokens.forEach((token) => {
        let pill: HTMLElement;

        try {
          pill = createDesignTokenElement(token, { prefix });
        } catch (error) {
          pill = document.createElement('span');
          pill.className = 'demo-pill-error';
          pill.textContent = `${token.name}: ${(error as Error).message}`;
        }

        pill.tabIndex = 0;
        pill.dataset.demoId = token.id;
        list.append(pill);
      });
      section.append(heading, list);

      return section;
    })
  );
  // Wrapped values as wide as their widest line, not the pill's maximum
  fitWrappedValues(listEl);

  // A selected token that is gone closes the details
  if (selectedId && !byId(selectedId)) closeDetails(false);

  highlight(selectedId);
};
const byId = (id: string | null) => tokens.find((token) => token.id === id);
const pillFor = (tokenId: string) =>
  listEl.querySelector<HTMLElement>(`[data-demo-id="${CSS.escape(tokenId)}"]`);
const highlight = (id: string | null) => {
  const token = byId(id);
  const related = new Set([
    ...(token?.ancestors ?? []),
    ...(token?.descendants ?? [])
  ]);

  listEl.querySelectorAll<HTMLElement>('[data-demo-id]').forEach((pill) => {
    pill.classList.toggle('is-selected', pill.dataset.demoId === id);
    pill.classList.toggle(
      'is-related',
      related.has(pill.dataset.demoId as string)
    );
  });

  // Arrows point from the referenced token to the token that references it
  const pill = token ? pillFor(token.id) : null;

  arclace.clear();

  if (!token || !pill) return;

  token.ancestors.forEach((ancestorId) => {
    const ancestor = pillFor(ancestorId);

    if (ancestor) arclace.connect(ancestor, pill);
  });
  token.descendants.forEach((descendantId) => {
    const descendant = pillFor(descendantId);

    if (descendant) arclace.connect(pill, descendant);
  });
};
const relationButtons = (ids: string[]) =>
  ids.length
    ? ids
        .map(
          (id) =>
            `<button type="button" class="demo-link" data-select="${escape(id)}">${escape(id)}</button>`
        )
        .join(' ')
    : '<span class="demo-muted">none</span>';
const CLOSE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';
const select = (id: string | null) => {
  const token = byId(id);

  selectedId = token ? token.id : null;
  highlight(selectedId);

  if (!token) return;

  let html: string;
  let css: string;

  try {
    html = renderDesignToken(token, { prefix: prefixEl.value });
    css = toCssValue(token);
  } catch (error) {
    html = css = `Error: ${(error as Error).message}`;
  }

  detailsEl.innerHTML = `
    <div class="demo-details-head">
      <h2 tabindex="-1">${escape(token.name)}</h2>
      <button type="button" class="demo-icon-button" data-close aria-label="Close the details">${CLOSE_ICON}</button>
    </div>
    <dl class="demo-dl">
      <dt>id</dt><dd><code>${escape(token.id)}</code></dd>
      <dt>$type</dt><dd><code>${escape(token.$type)}</code></dd>
      <dt>Pill variant</dt><dd><code>${escape(getDesignTokenKind(token))}</code></dd>
      <dt>CSS value</dt><dd><code>${escape(css)}</code></dd>
      ${token.$description ? `<dt>$description</dt><dd>${escape(token.$description)}</dd>` : ''}
      ${token.$deprecated ? `<dt>$deprecated</dt><dd>${escape(String(token.$deprecated))}</dd>` : ''}
      <dt>Ancestors</dt><dd>${relationButtons(token.ancestors)}</dd>
      <dt>Descendants</dt><dd>${relationButtons(token.descendants)}</dd>
    </dl>
    <h3><code>$value</code></h3>
    ${json(token.$value)}
    ${token.aliasOf || token.ancestors.length ? `<h3>Resolved value</h3>${json(token.value)}` : ''}
    ${token.$extensions ? `<h3><code>$extensions</code></h3>${json(token.$extensions)}` : ''}
    <h3><code>renderDesignToken()</code> <button type="button" class="demo-link" id="copy">copy</button></h3>
    ${codeBlock(formatHtml(html), 'html', 'demo-html')}
  `;

  if (newToken.isOpen()) newToken.close(false);

  detailsEl.hidden = false;
  document.body.classList.add('has-details');
  // The details narrow the pills, which can move the selected one out of view
  pillFor(token.id)?.scrollIntoView({ block: 'nearest' });

  // The pretty printed HTML is for reading; copy gives it as rendered
  detailsEl.querySelector('#copy')?.addEventListener('click', (event) => {
    navigator.clipboard?.writeText(html).then(() => {
      (event.target as HTMLElement).textContent = 'copied';
    });
  });
};
/** Closes the details, and moves focus back to the pill when asked */
const closeDetails = (refocus = true) => {
  const pill = selectedId ? pillFor(selectedId) : null;

  detailsEl.hidden = true;
  document.body.classList.toggle('has-details', newToken.isOpen());
  selectedId = null;
  highlight(null);

  if (refocus && pill) pill.focus();
};
const loadPreset = (value: Preset) => {
  const saved = readSaved(store);

  sourceEl.value =
    value === 'custom'
      ? (saved.custom ?? JSON.stringify(PRESETS.showcase, null, 2))
      : JSON.stringify(PRESETS[value], null, 2);
  setPreset(value);
  writeSaved(store, { preset: value });
  void parse();
  updateSource();
};

let parseTimer: number | undefined;

sourceEl.addEventListener('input', () => {
  updateSource();
  setPreset('custom');
  writeSaved(store, { preset: 'custom', custom: sourceEl.value });
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(() => void parse(), 250);
});
presetEls.forEach((input) =>
  input.addEventListener('change', () => loadPreset(input.value as Preset))
);

/**
 * Says what happened to a file, or how far loading it has come, under the
 * drop zone. `steps` lists the steps of loading, each done, current or to do.
 */
const showFileStatus = (
  message: string,
  {
    refused = false,
    steps,
    progress,
    cancel
  }: {
    refused?: boolean;
    steps?: [string, 'done' | 'current' | 'todo'][];
    progress?: { value: number; max: number };
    cancel?: () => void;
  } = {}
) => {
  const parts: (Node | string)[] = [];
  const text = document.createElement('p');

  text.textContent = message;
  parts.push(text);

  if (progress) {
    const bar = document.createElement('progress');

    bar.max = progress.max;
    bar.value = progress.value;
    bar.setAttribute('aria-label', message);
    parts.push(bar);
  }

  if (steps) {
    const list = document.createElement('ol');

    list.className = 'demo-steps';
    list.append(
      ...steps.map(([label, state]) => {
        const item = document.createElement('li');

        item.className = `is-${state}`;
        item.textContent = label;

        if (state === 'current') item.setAttribute('aria-current', 'step');

        return item;
      })
    );
    parts.push(list);
  }

  if (cancel) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'demo-button';
    button.textContent = 'Cancel';
    button.addEventListener('click', cancel);
    parts.push(button);
  }

  fileStatusEl.replaceChildren(...parts);
  fileStatusEl.classList.toggle('is-refused', refused);
  fileStatusEl.classList.toggle('is-busy', Boolean(steps));
};
const STEPS = ['Read the file', 'Check the tokens', 'Save in this browser'];
const steps = (current: number): [string, 'done' | 'current' | 'todo'][] =>
  STEPS.map((label, index) => [
    label,
    index < current ? 'done' : index === current ? 'current' : 'todo'
  ]);
/** Reads a file as text, reporting progress; resolves null when cancelled */
const readFile = (file: File): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    const label = `Reading "${file.name}" (${formatBytes(file.size)})`;

    reader.addEventListener('progress', (event) =>
      showFileStatus(label, {
        steps: steps(0),
        progress: { value: event.loaded, max: event.total || file.size },
        cancel: () => reader.abort()
      })
    );
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.addEventListener('abort', () => resolve(null));
    reader.addEventListener('error', () => reject(reader.error));
    showFileStatus(label, {
      steps: steps(0),
      progress: { value: 0, max: file.size },
      cancel: () => reader.abort()
    });
    reader.readAsText(file);
  });

let loading = false;

/** Your tokens, when you have some: to add a file to, or replace */
const yourTokens = () => {
  if (preset() !== 'custom' || !sourceEl.value.trim()) return null;

  try {
    return {
      document: JSON.parse(sourceEl.value) as DTCGDocument,
      count: tokens.length
    };
  } catch {
    return { document: null, count: tokens.length };
  }
};
/** Puts a document in the editor as your tokens, checked and saved */
const useDocument = async (text: string) => {
  window.clearTimeout(parseTimer);
  sourceEl.value = text;
  sourceEl.scrollTop = 0;
  setPreset('custom');

  const saved = writeSaved(store, { preset: 'custom', custom: text });

  updateSource();
  await parse();

  return saved;
};
/**
 * Loads a token file from your computer (#102, #109, #114, #117): read in
 * the browser with progress, then read in the worker. A Tokens Studio file
 * goes through the import wizard, to choose its theme or sets; any file goes
 * through it when you have tokens, to add to them or replace them.
 */
const loadFile = async (file: File) => {
  if (loading) return;

  const tooLarge = refuseTokenFile(file);

  if (tooLarge) return showFileStatus(tooLarge, { refused: true });

  loading = true;

  try {
    const text = await readFile(file);

    if (text === null)
      return showFileStatus(`Cancelled: "${file.name}" was not loaded.`);

    const refused = refuseTokenFile(file, text);

    if (refused) return showFileStatus(refused, { refused: true });

    showFileStatus(
      `Checking ${plural(countTokens(text), 'token')} in "${file.name}"`,
      { steps: steps(1) }
    );

    const converted = await convert(text);
    const yours = yourTokens();
    const studio = converted?.summary.format === 'tokens-studio';

    let loadText = text;
    let message = '';

    if (converted && (studio || yours)) {
      const result = await runImportWizard({
        fileName: file.name,
        first: converted,
        convert: (choice) => convert(text, choice),
        check,
        yours
      });

      if (!result) {
        showFileStatus(`Kept your tokens. "${file.name}" was not loaded.`);
        loadFileEl.focus();

        return;
      }

      // A DTCG file replacing yours keeps its own formatting
      loadText =
        result.mode === 'replace' && !studio
          ? text
          : JSON.stringify(result.document, null, 2);
      message =
        result.mode === 'add'
          ? `Added ${plural(result.count, 'token')} from "${file.name}"${result.overwritten ? `, overwriting ${result.overwritten}` : ''}`
          : `Loaded ${plural(result.count, 'token')} from "${file.name}"${studio ? ', converted from Tokens Studio' : ''}`;
    } else if (!converted && yours) {
      // Not JSON: it can only replace your tokens, so ask first
      const result = await runImportWizard({
        fileName: file.name,
        first: {
          summary: {
            format: 'dtcg',
            sets: [{ name: 'tokens', count: 0 }],
            themes: []
          },
          uses: {},
          conversion: { document: {} as DTCGDocument, converted: 0, notes: [] },
          checked: { tokens: [], problems: [], json: false }
        },
        convert: async () => null,
        check,
        yours: { document: null, count: yours.count }
      });

      if (!result) {
        showFileStatus(`Kept your tokens. "${file.name}" was not loaded.`);

        return;
      }
    }

    showFileStatus(`Saving "${file.name}" in this browser`, {
      steps: steps(2)
    });

    const saved = await useDocument(loadText);
    const summary = `${plural(tokens.length, 'token')}${problems.length ? `, ${plural(problems.length, 'problem')}` : ''}`;

    showFileStatus(
      !saved
        ? `Loaded "${file.name}", but your browser could not save it: it will be gone when you leave.`
        : message
          ? `${message}: ${summary} now.`
          : `Loaded "${file.name}" (${formatBytes(file.size)}): ${summary}.`,
      { refused: !saved }
    );
  } catch {
    showFileStatus(`"${file.name}" could not be read.`, { refused: true });
  } finally {
    loading = false;
  }
};

// The wizard's backdrop keeps your tokens, like Esc and Cancel
importEl.addEventListener('click', (event) => {
  if (event.target === importEl) importEl.close('cancel');
});
exportEl.addEventListener('click', (event) => {
  if (event.target === exportEl) exportEl.close('close');
});

// Export: your tokens, or while your edits have problems, the last version
// without (#115)
$<HTMLButtonElement>('#export-open').addEventListener('click', async () => {
  // The export, and the converter it uses, load when first needed
  const { openExportDialog } = await import('./export-dialog');

  if (problems.length === 0 && tokens.length > 0) {
    try {
      return openExportDialog(
        {
          document: JSON.parse(sourceEl.value) as DTCGDocument,
          tokens,
          earlier: false
        },
        announce
      );
    } catch {
      // Not JSON: falls through to the last valid version
    }
  }

  const valid = readSaved(store).valid;

  if (preset() === 'custom' && valid) {
    const checked = checkTokenText(valid);

    return openExportDialog(
      {
        document: JSON.parse(valid) as DTCGDocument,
        tokens: checked.tokens,
        earlier: true
      },
      announce
    );
  }

  announce('There are no tokens to export yet: fix the problems first');
});

// The new token form (#116), in the details column
const newToken = mountNewTokenForm({
  tokens: () => tokens,
  document: () => {
    try {
      return JSON.parse(sourceEl.value) as DTCGDocument;
    } catch {
      return null;
    }
  },
  prefix: () => prefixEl.value,
  add: async (document, name) => {
    await useDocument(JSON.stringify(document, null, 2));

    const added = tokens.find((token) => token.name === name);

    if (added) {
      select(added.id);
      pillFor(added.id)?.focus();
    }

    announce(`Added ${name}`);
  },
  toggle: (open) => {
    if (open && !detailsEl.hidden) {
      detailsEl.hidden = true;
      selectedId = null;
      highlight(null);
    }

    document.body.classList.toggle('has-details', open || !detailsEl.hidden);
  }
});

$<HTMLButtonElement>('#new-token-open').addEventListener('click', () =>
  newToken.open()
);

loadFileEl.addEventListener('click', () => fileEl.click());
fileEl.addEventListener('change', () => {
  const [file] = fileEl.files ?? [];

  // The same file can be chosen again
  fileEl.value = '';

  if (file) void loadFile(file);
});

// A file dropped anywhere on the playground loads it; dropped text is left
// to the textarea
const hasFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes('Files') ?? false;
const mainEl = $<HTMLElement>('.demo-main');

mainEl.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;

  event.preventDefault();
  dropEl.classList.add('is-dropping');
});
mainEl.addEventListener('dragleave', (event) => {
  // Only when the pointer leaves the playground, not one of its children
  if (!mainEl.contains(event.relatedTarget as Node | null))
    dropEl.classList.remove('is-dropping');
});
mainEl.addEventListener('drop', (event) => {
  dropEl.classList.remove('is-dropping');

  if (!hasFiles(event)) return;

  event.preventDefault();

  const [file] = event.dataTransfer?.files ?? [];

  if (file) void loadFile(file);
});
prefixEl.addEventListener('input', () => {
  render();
  select(selectedId);
});
filterEl.addEventListener('input', render);

// One column (as in playground.css): the details cover the page, so a
// selection moves focus into them, and closing them moves it back
const oneColumn = matchMedia('(max-width: 1100px)');
const selectFromEvent = (event: Event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-demo-id], [data-select]'
  );

  if (!target) return;

  select(target.dataset.demoId ?? target.dataset.select ?? null);

  const heading = detailsEl.querySelector<HTMLElement>('h2');

  if (oneColumn.matches && selectedId && heading)
    heading.focus({ preventScroll: true });
};

groupsEl.addEventListener('click', selectFromEvent);
groupsEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectFromEvent(event);
  }
});
detailsEl.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('[data-close]'))
    return closeDetails();

  selectFromEvent(event);
});
// Esc closes the details, unless a dialog takes it
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || importEl.open || exportEl.open) return;

  if (newToken.isOpen()) newToken.close();
  else if (!detailsEl.hidden) closeDetails();
});

let hoveredId: string | null = null;

groupsEl.addEventListener('mouseover', (event) => {
  const pill = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-demo-id]'
  );

  // mouseover also fires for the pill's children, only redraw when the pill changes
  if (!pill || pill.dataset.demoId === hoveredId) return;

  hoveredId = pill.dataset.demoId as string;
  highlight(hoveredId);
});
groupsEl.addEventListener('mouseleave', () => {
  hoveredId = null;
  highlight(selectedId);
});

mountHeader();
// On a wide screen the sidebar collapses to a rail; the panels take the space (#120)
mountSidebarCollapse(
  document.querySelector(
    '#playground-sidebar .app-sidebar-collapse'
  ) as HTMLButtonElement,
  'dtf-sidebar-playground'
);
bundledCountEl.textContent = plural(
  countTokens(JSON.stringify(bundledTokens)),
  'token'
);
loadPreset(readSaved(store).preset ?? 'showcase');

// Shiki loads after the page, in its own chunk; the page works without it
import('../src/app/highlight')
  .then(({ loadHighlighter }) => loadHighlighter())
  .then((loaded) => {
    colorize = loaded;
    highlightSource();
    select(selectedId);
  })
  .catch(() => {
    // Plain text stays
  });
