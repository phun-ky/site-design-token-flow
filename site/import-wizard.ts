// The import wizard (#114, #117): a Tokens Studio file is converted with the
// theme or sets you choose, and any file can be added to your tokens or
// replace them, after a review of what changes. Text from the file is only
// ever set as text, never as markup.
import type { CheckedTokens } from '../src/app/check-tokens';
import type { ConvertedTokens, FileSummary } from '../src/app/convert-tokens';
import {
  mergeTokenDocuments,
  type DTCGDocument,
  type Merge
} from '../src/tokens';
import type {
  ConversionNote,
  NoteKind,
  SetUse
} from '../src/tokens/tokens-studio';

export interface WizardOptions {
  fileName: string;
  /** The file, converted with the first theme or every set */
  first: ConvertedTokens;
  /** Converts the file again with another theme or other sets */
  convert: (choice: {
    theme?: string;
    uses?: Record<string, SetUse>;
  }) => Promise<ConvertedTokens | null>;
  /** Checks a document, to report problems after an add */
  check: (text: string) => Promise<CheckedTokens>;
  /** Your tokens, when you have some, to add to or replace */
  yours: { document: DTCGDocument | null; count: number } | null;
}

export interface WizardResult {
  mode: 'add' | 'replace';
  /** The document to load: the merge, or the file's tokens */
  document: DTCGDocument;
  /** How many tokens it brings, and what an add overwrote */
  count: number;
  overwritten: number;
}

type Child = Node | string | null | false | undefined;

/** An element with attributes and children; text children stay text */
const el = <T extends HTMLElement = HTMLElement>(
  tag: string,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): T => {
  const element = document.createElement(tag) as T;

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === undefined || value === false) return;

    if (name === 'class') element.className = String(value);
    else element.setAttribute(name, value === true ? '' : value);
  });
  element.append(
    ...children.filter((child): child is Node | string => Boolean(child))
  );

  return element;
};
const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;
const short = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);

  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};
const KINDS: { kind: NoteKind; title: string }[] = [
  { kind: 'math', title: 'Math worked out' },
  { kind: 'resolved', title: 'References inside text resolved' },
  { kind: 'modified', title: 'Colour modifiers applied' },
  { kind: 'changed', title: 'Changed to fit DTCG' },
  { kind: 'defaulted', title: 'Filled in' },
  { kind: 'overridden', title: 'Overridden by a later set' },
  { kind: 'left-out', title: 'Left out' }
];
const USES: { use: SetUse; label: string }[] = [
  { use: 'included', label: 'Included' },
  { use: 'reference', label: 'Reference only' },
  { use: 'left-out', label: 'Left out' }
];
const describeFile = (summary: FileSummary) =>
  summary.format === 'dtcg'
    ? `A DTCG file with ${plural(summary.sets[0]?.count ?? 0, 'token')}.`
    : summary.hasSets
      ? `A Tokens Studio file with ${plural(summary.sets.length, 'token set')} and ${plural(summary.themes.length, 'theme')}, written with ${summary.keyStyle === 'dtcg' ? '$value and $type' : 'value and type'}.`
      : `A Tokens Studio file with one set of ${plural(summary.sets[0]?.count ?? 0, 'token')}, written with ${summary.keyStyle === 'dtcg' ? '$value and $type' : 'value and type'}.`;
/** A <details> listing notes of one kind */
const noteList = (title: string, notes: ConversionNote[]) =>
  notes.length
    ? el(
        'details',
        { class: 'demo-report-group' },
        el('summary', {}, `${title} (${notes.length})`),
        el(
          'ul',
          {},
          ...notes
            .slice(0, 200)
            .map((note) =>
              el('li', {}, el('code', {}, note.name), ' ', note.detail)
            ),
          notes.length > 200 && el('li', {}, `and ${notes.length - 200} more`)
        )
      )
    : null;

/**
 * Runs the wizard in the `#import` dialog.
 *
 * @param {WizardOptions} options The file and what the wizard needs
 * @returns {Promise<WizardResult | null>} What to load, or null when cancelled
 */
export const runImportWizard = (
  options: WizardOptions
): Promise<WizardResult | null> => {
  const dialog = document.querySelector('#import') as HTMLDialogElement;
  const body = dialog.querySelector('#import-body') as HTMLElement;
  const name = dialog.querySelector('#import-name') as HTMLElement;
  const stepsEl = dialog.querySelector('#import-steps') as HTMLOListElement;
  const back = dialog.querySelector('#import-back') as HTMLButtonElement;
  const next = dialog.querySelector('#import-next') as HTMLButtonElement;
  const studio = options.first.summary.format === 'tokens-studio';
  const steps = [
    { id: 'format', title: 'Format' },
    ...(studio ? [{ id: 'sets', title: 'Choose the tokens' }] : []),
    { id: 'review', title: options.yours ? 'Review and load' : 'Review' }
  ];

  let step = 0;
  let current = options.first;
  let theme: string | undefined = options.first.summary.themes[0]?.id;
  let mode: 'add' | 'replace' = 'add';
  let merge: Merge | null = null;
  let afterProblems: number | null = null;
  let run = 0;

  name.textContent = options.fileName;

  const result = (): WizardResult => {
    const adding = mode === 'add' && options.yours?.document && merge;

    return {
      mode: adding ? 'add' : 'replace',
      document: adding ? merge!.document : current.conversion.document,
      count: current.conversion.converted,
      overwritten: adding ? merge!.overwritten.length : 0
    };
  };
  /** Recomputes the merge and the problems it leaves, for the review */
  const prepare = async () => {
    const yours = options.yours?.document;
    const id = (run += 1);

    merge = yours
      ? mergeTokenDocuments(yours, current.conversion.document)
      : null;
    afterProblems = null;
    render();

    const checked = await options.check(JSON.stringify(result().document));

    if (id !== run) return;

    afterProblems = checked.problems.length;
    render();
  };
  const reconvert = async (choice: {
    theme?: string;
    uses?: Record<string, SetUse>;
  }) => {
    const id = (run += 1);

    body.setAttribute('aria-busy', 'true');

    const converted = await options.convert(choice);

    body.removeAttribute('aria-busy');

    if (id !== run || !converted) return;

    current = converted;
    render();
  };
  const formatStep = () =>
    el(
      'div',
      { class: 'demo-wizard-step' },
      el('p', {}, describeFile(current.summary)),
      studio
        ? el(
            'p',
            { class: 'demo-muted' },
            'The playground uses DTCG 2025.10, so it converts the file. What DTCG can’t hold is kept with your tokens, so an export to Tokens Studio gives the file back.'
          )
        : null,
      current.summary.format === 'tokens-studio' && !current.summary.hasSets
        ? el(
            'p',
            { class: 'demo-muted' },
            'It has no $themes or $metadata, so its top-level keys are read as groups of one set.'
          )
        : null
    );
  const setsStep = () => {
    const select = el<HTMLSelectElement>(
      'select',
      { id: 'import-theme', 'aria-describedby': 'import-theme-hint' },
      ...current.summary.themes.map(({ id, name: label, group }) =>
        el(
          'option',
          { value: id, selected: id === theme },
          group ? `${group}: ${label}` : label
        )
      ),
      el(
        'option',
        { value: '', selected: theme === undefined },
        'No theme: choose the sets'
      )
    );

    select.addEventListener('change', () => {
      theme = select.value || undefined;
      void reconvert(theme ? { theme } : { theme: '', uses: allIncluded() });
    });

    const allIncluded = () =>
      Object.fromEntries(
        current.summary.sets.map(({ name: set }) => [set, 'included'])
      ) as Record<string, SetUse>;
    const rows = current.summary.sets.map(({ name: set, count }) => {
      const use = el<HTMLSelectElement>(
        'select',
        { 'aria-label': `Use of the set ${set}` },
        ...USES.map(({ use: value, label }) =>
          el('option', { value, selected: current.uses[set] === value }, label)
        )
      );

      use.addEventListener('change', () => {
        theme = undefined;
        void reconvert({
          theme: '',
          uses: { ...current.uses, [set]: use.value as SetUse }
        });
      });

      return el(
        'tr',
        {},
        el('th', { scope: 'row' }, el('code', {}, set)),
        el('td', {}, use),
        el('td', { class: 'demo-number' }, String(count))
      );
    });
    const count = (kind: NoteKind) =>
      current.conversion.notes.filter((note) => note.kind === kind).length;

    return el(
      'div',
      { class: 'demo-wizard-sets' },
      el(
        'div',
        { class: 'demo-wizard-step' },
        current.summary.themes.length
          ? el(
              'label',
              { class: 'demo-field', for: 'import-theme' },
              el('span', { class: 'demo-label' }, 'Start from a theme'),
              select,
              el(
                'span',
                { id: 'import-theme-hint', class: 'demo-hint' },
                'Its enabled and source sets are included, its disabled sets left out'
              )
            )
          : null,
        el(
          'table',
          { class: 'demo-sets' },
          el('caption', {}, 'Token sets, in the order they apply'),
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { scope: 'col' }, 'Set'),
              el('th', { scope: 'col' }, 'Use'),
              el('th', { scope: 'col', class: 'demo-number' }, 'Tokens')
            )
          ),
          el('tbody', {}, ...rows)
        ),
        el(
          'p',
          { class: 'demo-hint' },
          'A later set overrides an earlier one. Reference only sets resolve references; their own tokens are not added.'
        )
      ),
      el(
        'aside',
        {
          class: 'demo-wizard-counts',
          'aria-labelledby': 'import-counts-title'
        },
        el('h3', { id: 'import-counts-title' }, 'So far'),
        el(
          'dl',
          { class: 'demo-dl' },
          el('dt', {}, 'Tokens to load'),
          el('dd', {}, String(current.conversion.converted)),
          ...KINDS.flatMap(({ kind, title }) => [
            el('dt', {}, title),
            el('dd', {}, String(count(kind)))
          ]),
          el('dt', {}, 'Problems'),
          el('dd', {}, String(current.checked.problems.length))
        )
      )
    );
  };
  const reviewStep = () => {
    const yours = options.yours;
    const adding = mode === 'add' && yours?.document;
    const parts: Child[] = [
      el(
        'p',
        {},
        `${plural(current.conversion.converted, 'token')} from ${options.fileName}${studio && theme ? `, theme “${current.summary.themes.find(({ id }) => id === theme)?.name ?? theme}”` : ''}.`
      )
    ];

    if (yours) {
      const option = (
        value: 'add' | 'replace',
        label: string,
        detail: string,
        disabled = false
      ) => {
        const input = el<HTMLInputElement>('input', {
          type: 'radio',
          name: 'import-mode',
          value,
          checked: mode === value,
          disabled
        });

        input.addEventListener('change', () => {
          mode = value;
          void prepare();
        });

        return el(
          'label',
          { class: 'demo-format' },
          input,
          el('span', {}, label, el('span', { class: 'demo-muted' }, detail))
        );
      };

      parts.push(
        el(
          'fieldset',
          { class: 'demo-formats' },
          el('legend', { class: 'demo-label' }, 'Your tokens'),
          option(
            'add',
            'Add to your tokens',
            yours.document
              ? merge
                ? `Adds ${plural(merge.added.length, 'token')} to your ${yours.count}, overwrites ${plural(merge.overwritten.length, 'token')} of the same name${merge.unchanged.length ? `, and leaves ${merge.unchanged.length} that are the same` : ''}.`
                : 'Adds the tokens to yours.'
              : 'Your JSON has a syntax error, so tokens can’t be added to it.',
            !yours.document
          ),
          option(
            'replace',
            'Replace your tokens',
            `Your ${plural(yours.count, 'token')} are replaced, and can’t be brought back.`
          )
        )
      );
    }

    if (adding && merge?.overwritten.length)
      parts.push(
        el(
          'details',
          { class: 'demo-report-group', open: true },
          el('summary', {}, `Overwritten (${merge.overwritten.length})`),
          el(
            'ul',
            {},
            ...merge.overwritten
              .slice(0, 200)
              .map(({ name: token, before, after }) =>
                el(
                  'li',
                  {},
                  el('code', {}, token),
                  ' ',
                  after === undefined
                    ? 'becomes a group'
                    : `${short(before)} → ${short(after)}`
                )
              )
          )
        )
      );

    parts.push(
      ...KINDS.map(({ kind, title }) =>
        noteList(
          title,
          current.conversion.notes.filter((note) => note.kind === kind)
        )
      ),
      el(
        'p',
        { class: 'demo-hint', role: 'status' },
        afterProblems === null
          ? 'Checking the result…'
          : afterProblems === 0
            ? 'No problems after loading.'
            : `${plural(afterProblems, 'problem')} after loading, listed in the sidebar; the valid tokens are shown.`
      )
    );

    return el('div', { class: 'demo-wizard-step' }, ...parts);
  };
  const render = () => {
    const id = steps[step].id;

    stepsEl.replaceChildren(
      ...steps.map(({ title }, index) =>
        el(
          'li',
          {
            class:
              index < step
                ? 'is-done'
                : index === step
                  ? 'is-current'
                  : 'is-todo',
            'aria-current': index === step ? 'step' : undefined
          },
          title
        )
      )
    );
    body.replaceChildren(
      id === 'format' ? formatStep() : id === 'sets' ? setsStep() : reviewStep()
    );
    back.hidden = step === 0;
    next.textContent =
      id !== 'review'
        ? 'Next'
        : mode === 'add' && options.yours?.document
          ? `Add ${plural(current.conversion.converted, 'token')}`
          : `Load ${plural(current.conversion.converted, 'token')}`;
    next.disabled = id === 'review' && current.conversion.converted === 0;
  };

  return new Promise((resolve) => {
    const go = (to: number) => {
      step = to;

      if (steps[step].id === 'review') void prepare();
      else render();

      next.focus();
    };
    const onNext = () => {
      if (steps[step].id !== 'review') return go(step + 1);

      dialog.close('done');
    };
    const onBack = () => go(Math.max(0, step - 1));

    next.addEventListener('click', onNext);
    back.addEventListener('click', onBack);
    dialog.addEventListener(
      'close',
      () => {
        next.removeEventListener('click', onNext);
        back.removeEventListener('click', onBack);
        run += 1;
        resolve(dialog.returnValue === 'done' ? result() : null);
      },
      { once: true }
    );
    mode = options.yours?.document ? 'add' : 'replace';
    dialog.returnValue = '';
    render();
    dialog.showModal();
    next.focus();
  });
};
