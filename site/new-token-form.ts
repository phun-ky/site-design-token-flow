// The new token form (#116): a primitive, with a value editor for its type,
// or a semantic token, referring to a token you have. It is added to your
// tokens like an edit: the editor's JSON is written again, 2 spaces.
import {
  createDesignTokenElement,
  mergeTokenDocuments,
  validateTokens,
  type DTCGDocument,
  type DTCGType,
  type FlatDesignToken
} from '../src/tokens';

export interface NewTokenContext {
  /** Your tokens as they are now */
  tokens: () => FlatDesignToken[];
  /** The editor's JSON, or null when it isn't JSON */
  document: () => DTCGDocument | null;
  prefix: () => string;
  /** Writes the document to the editor, then selects the new token */
  add: (document: DTCGDocument, name: string) => Promise<void>;
  /** Called when the form opens or closes, to fit the layout */
  toggle: (open: boolean) => void;
}

type Editor = {
  element: HTMLElement;
  /** The DTCG value, or throws an Error saying what is wrong */
  value: () => unknown;
};

const NAME = /^[^{}.$][^{}.]*$/;
// check-colours-ignore-next-line: a new colour token's starting value, not a colour of the page
const START_COLOUR = '#0054f0';
const STROKE_STYLES = [
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'outset',
  'inset'
];
// Starting values for the composites, edited as JSON
const TEMPLATES: Partial<Record<DTCGType, unknown>> = {
  shadow: {
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 2, unit: 'px' },
    blur: { value: 4, unit: 'px' },
    spread: { value: 0, unit: 'px' }
  },
  border: {
    color: { colorSpace: 'srgb', components: [0, 0, 0] },
    width: { value: 1, unit: 'px' },
    style: 'solid'
  },
  transition: {
    duration: { value: 200, unit: 'ms' },
    delay: { value: 0, unit: 'ms' },
    timingFunction: [0.4, 0, 0.2, 1]
  },
  typography: {
    fontFamily: ['Inter', 'sans-serif'],
    fontWeight: 400,
    fontSize: { value: 16, unit: 'px' },
    letterSpacing: { value: 0, unit: 'px' },
    lineHeight: 1.5
  },
  gradient: [
    { color: { colorSpace: 'srgb', components: [0, 0, 0] }, position: 0 },
    { color: { colorSpace: 'srgb', components: [1, 1, 1] }, position: 1 }
  ]
};
const input = (attributes: Record<string, string>) => {
  const element = document.createElement('input');

  Object.entries(attributes).forEach(([name, value]) =>
    element.setAttribute(name, value)
  );

  return element;
};
const select = (label: string, options: string[], value: string) => {
  const element = document.createElement('select');

  element.setAttribute('aria-label', label);
  element.append(
    ...options.map((option) => {
      const item = document.createElement('option');

      item.value = item.textContent = option;
      item.selected = option === value;

      return item;
    })
  );

  return element;
};
const row = (...children: HTMLElement[]) => {
  const element = document.createElement('div');

  element.className = 'demo-value-row';
  element.append(...children);

  return element;
};
const number = (element: HTMLInputElement, what: string) => {
  const value = element.valueAsNumber;

  if (!Number.isFinite(value)) throw Error(`${what} must be a number`);

  return value;
};
/** The value editor for a type */
const editorFor = (type: DTCGType): Editor => {
  switch (type) {
    case 'color': {
      const picker = input({
        type: 'color',
        value: START_COLOUR,
        'aria-label': 'Colour'
      });
      const hex = input({
        type: 'text',
        value: START_COLOUR,
        'aria-label': 'Hex',
        size: '9'
      });

      picker.addEventListener('input', () => (hex.value = picker.value));
      hex.addEventListener('input', () => {
        if (/^#[\da-f]{6}$/i.test(hex.value)) picker.value = hex.value;
      });

      return {
        element: row(picker, hex),
        value: () => {
          if (!/^#[\da-f]{6}$/i.test(hex.value))
            throw Error(
              `The colour must be a 6 digit hex, such as ${START_COLOUR}`
            );

          const channels = [1, 3, 5].map(
            (index) =>
              Math.round(
                (parseInt(hex.value.slice(index, index + 2), 16) / 255) * 10000
              ) / 10000
          );

          return {
            colorSpace: 'srgb',
            components: channels,
            hex: hex.value.toLowerCase()
          };
        }
      };
    }
    case 'dimension':
    case 'duration': {
      const amount = input({
        type: 'number',
        value: type === 'duration' ? '200' : '8',
        step: 'any',
        'aria-label': 'Value'
      });
      const units = type === 'duration' ? ['ms', 's'] : ['px', 'rem'];
      const unit = select('Unit', units, units[0]);

      return {
        element: row(amount, unit),
        value: () => ({ value: number(amount, 'The value'), unit: unit.value })
      };
    }
    case 'number': {
      const amount = input({
        type: 'number',
        value: '1',
        step: 'any',
        'aria-label': 'Value'
      });

      return { element: row(amount), value: () => number(amount, 'The value') };
    }
    case 'fontWeight': {
      const weight = input({
        type: 'number',
        value: '400',
        min: '1',
        max: '1000',
        step: '100',
        'aria-label': 'Weight, 1 to 1000'
      });

      return {
        element: row(weight),
        value: () => {
          const value = number(weight, 'The weight');

          if (value < 1 || value > 1000)
            throw Error('The weight must be 1 to 1000');

          return value;
        }
      };
    }
    case 'fontFamily': {
      const families = input({
        type: 'text',
        value: 'Inter, sans-serif',
        'aria-label': 'Font families, separated by commas'
      });

      return {
        element: row(families),
        value: () => {
          const names = families.value
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean);

          if (!names.length) throw Error('Give at least one font family');

          return names.length === 1 ? names[0] : names;
        }
      };
    }
    case 'cubicBezier': {
      const curve = input({
        type: 'text',
        value: '0.4, 0, 0.2, 1',
        'aria-label': 'Four numbers: x1, y1, x2, y2'
      });

      return {
        element: row(curve),
        value: () => {
          const numbers = curve.value
            .split(',')
            .map((part) => Number(part.trim()));

          if (
            numbers.length !== 4 ||
            numbers.some((part) => !Number.isFinite(part))
          )
            throw Error('The curve needs four numbers, such as 0.4, 0, 0.2, 1');

          return numbers;
        }
      };
    }
    case 'strokeStyle': {
      const style = select('Style', STROKE_STYLES, 'solid');

      return { element: row(style), value: () => style.value };
    }
    default: {
      const json = document.createElement('textarea');

      json.className = 'demo-value-json';
      json.rows = 8;
      json.spellcheck = false;
      json.setAttribute('aria-label', `The ${type} value, as JSON`);
      json.value = JSON.stringify(TEMPLATES[type] ?? null, null, 2);

      return {
        element: row(json),
        value: () => {
          try {
            return JSON.parse(json.value);
          } catch {
            throw Error('The value is not valid JSON');
          }
        }
      };
    }
  }
};

/**
 * Wires the `#new-token` form.
 *
 * @param {NewTokenContext} context What the form needs from the playground
 * @returns {{ open: () => void; close: () => void; isOpen: () => boolean }} Controls
 */
export const mountNewTokenForm = (context: NewTokenContext) => {
  const panel = document.querySelector('#new-token') as HTMLElement;
  const form = panel.querySelector('form') as HTMLFormElement;
  const kinds = [
    ...form.querySelectorAll<HTMLInputElement>('input[name="new-kind"]')
  ];
  const group = form.querySelector('#new-group') as HTMLInputElement;
  const groups = form.querySelector('#new-groups') as HTMLDataListElement;
  const name = form.querySelector('#new-name') as HTMLInputElement;
  const nameHint = form.querySelector('#new-name-hint') as HTMLElement;
  const type = form.querySelector('#new-type') as HTMLSelectElement;
  const valueEl = form.querySelector('#new-value') as HTMLElement;
  const search = form.querySelector('#new-ref-search') as HTMLInputElement;
  const list = form.querySelector('#new-ref-list') as HTMLElement;
  const description = form.querySelector(
    '#new-description'
  ) as HTMLInputElement;
  const pill = form.querySelector('#new-preview-pill') as HTMLElement;
  const json = form.querySelector('#new-preview-json') as HTMLElement;
  const problem = form.querySelector('#new-problem') as HTMLElement;

  let editor = editorFor('color');
  let target: string | null = null;
  let opener: HTMLElement | null = null;

  const kind = () => kinds.find((item) => item.checked)?.value ?? 'primitive';
  const path = () => [
    ...group.value
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean),
    name.value.trim()
  ];
  const fullName = () => path().join('.');
  /** The new token, or throws an Error saying what is wrong */
  const token = (): Record<string, unknown> => {
    if (!name.value.trim()) throw Error('Give the token a name');

    const bad = path().find((part) => !NAME.test(part));

    if (bad !== undefined)
      throw Error(
        `"${bad}" can't be used: names can't start with $ or hold {, } or .`
      );

    const extra = description.value.trim()
      ? { $description: description.value.trim() }
      : {};

    if (kind() === 'semantic') {
      const referenced = context.tokens().find((item) => item.name === target);

      if (!referenced) throw Error('Choose the token it refers to');

      if (referenced.name === fullName())
        throw Error('A token can’t refer to itself');

      return {
        $type: referenced.$type,
        $value: `{${referenced.name}}`,
        ...extra
      };
    }

    return { $type: type.value, $value: editor.value(), ...extra };
  };
  const nest = (value: Record<string, unknown>) =>
    path().reduceRight<Record<string, unknown>>(
      (inner, key) => ({ [key]: inner }),
      value
    );
  const refresh = () => {
    const exists = context.tokens().some((item) => item.name === fullName());

    nameHint.textContent = exists
      ? 'A token with this name exists: adding replaces it.'
      : '';
    problem.textContent = '';
    pill.replaceChildren();
    json.textContent = '';

    let value: Record<string, unknown>;

    try {
      value = token();
    } catch (error) {
      json.textContent = (error as Error).message;

      return;
    }

    json.textContent = JSON.stringify(nest(value), null, 2);

    // The pill, from the value: a reference shows the value it ends at
    const referenced = context
      .tokens()
      .find((item) => `{${item.name}}` === value.$value);
    const preview = validateTokens(
      nest({
        ...value,
        ...(referenced && { $value: referenced.value })
      }) as DTCGDocument
    );

    if (preview.problems.length) {
      json.textContent += `\n\n${preview.problems[0].message}`;

      return;
    }

    try {
      pill.append(
        createDesignTokenElement(preview.tokens[0], {
          prefix: context.prefix()
        })
      );
    } catch (error) {
      json.textContent += `\n\n${(error as Error).message}`;
    }
  };
  const showKind = () => {
    form.querySelectorAll<HTMLElement>('[data-for]').forEach((part) => {
      part.hidden = part.dataset.for !== kind();
    });
    refresh();
  };
  const setType = () => {
    editor = editorFor(type.value as DTCGType);
    valueEl.replaceChildren(editor.element);
    refresh();
  };
  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const matches = context
      .tokens()
      .filter(
        (item) =>
          !query ||
          item.name.toLowerCase().includes(query) ||
          item.$type.includes(query)
      )
      .slice(0, 60);

    list.replaceChildren(
      ...matches.map((item) => {
        const label = document.createElement('label');
        const radio = input({
          type: 'radio',
          name: 'new-target',
          value: item.name
        });
        const code = document.createElement('code');
        const kindEl = document.createElement('span');

        radio.checked = item.name === target;
        radio.addEventListener('change', () => {
          target = item.name;
          refresh();
        });
        code.textContent = item.name;
        kindEl.className = 'demo-muted';
        kindEl.textContent = item.$type;
        label.className = 'demo-ref-option';
        label.append(radio, code, kindEl);

        return label;
      })
    );

    if (!matches.length) list.textContent = 'No tokens match.';
  };
  /** The groups you have, and the type most of their tokens share */
  const groupTypes = () => {
    const types = new Map<string, DTCGType>();

    context.tokens().forEach((item) => {
      const parent = item.path.slice(0, -1).join('.');

      if (parent && !types.has(parent)) types.set(parent, item.$type);
    });

    return types;
  };

  kinds.forEach((item) => item.addEventListener('change', showKind));
  type.addEventListener('change', setType);
  search.addEventListener('input', renderList);
  group.addEventListener('change', () => {
    const groupType = groupTypes().get(group.value.trim());

    if (
      groupType &&
      [...type.options].some((option) => option.value === groupType) &&
      type.value !== groupType
    ) {
      type.value = groupType;
      setType();
    }
  });
  form.addEventListener('input', (event) => {
    if (event.target !== search && event.target !== type) refresh();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    let value: Record<string, unknown>;

    try {
      value = token();
    } catch (error) {
      problem.textContent = (error as Error).message;

      return;
    }

    const current = context.document();

    if (!current) {
      problem.textContent =
        'The JSON in the editor has a syntax error: fix it first, then add the token.';

      return;
    }

    const name = fullName();

    close(false);
    await context.add(
      mergeTokenDocuments(current, nest(value) as DTCGDocument).document,
      name
    );
  });
  panel.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-close-new]')) close();
  });

  const open = () => {
    opener = document.activeElement as HTMLElement | null;
    form.reset();
    target = null;
    groups.replaceChildren(
      ...[...groupTypes().keys()].map((value) => {
        const option = document.createElement('option');

        option.value = value;

        return option;
      })
    );
    setType();
    renderList();
    showKind();
    panel.hidden = false;
    context.toggle(true);
    (
      form.querySelector('input[name="new-kind"]:checked') as HTMLElement
    ).focus();
  };
  const close = (refocus = true) => {
    panel.hidden = true;
    context.toggle(false);

    if (refocus) opener?.focus();
  };

  return { open, close, isOpen: () => !panel.hidden };
};
