// The export dialog (#115): your tokens as DTCG 2025.10, or as Tokens Studio
// JSON, which gives a file that came from Tokens Studio back as it came plus
// your new tokens. Copy or download; nothing is uploaded.
import type { DTCGDocument, FlatDesignToken } from '../src/tokens';
import { toTokensStudio, type ExportToken } from '../src/tokens/tokens-studio';

export interface ExportSource {
  document: DTCGDocument;
  tokens: FlatDesignToken[];
  /** When your latest edits have problems: the export is an earlier version */
  earlier: boolean;
}

const PREVIEW_LINES = 400;
const DTF_KEY = 'net.phun-ky.design-token-flow';
/** The JSON a format exports, and its default file name */
const exportText = (
  source: ExportSource,
  format: 'dtcg' | 'tokens-studio',
  set: string
) => {
  if (format === 'dtcg') return JSON.stringify(source.document, null, 2);

  const tokens: ExportToken[] = source.tokens.map(
    ({ name, $type, $value, value, $description, $extensions }) => ({
      name,
      $type,
      $value,
      value,
      ...($description && { $description }),
      ...($extensions && { $extensions })
    })
  );

  return JSON.stringify(
    toTokensStudio(
      tokens,
      (source.document as { $extensions?: Record<string, unknown> })
        .$extensions,
      set || undefined
    ),
    null,
    2
  );
};
/**
 * The set new tokens go in by default, as the export does: the last set,
 * in the file's order, that your tokens came from
 */
const defaultSet = (source: ExportSource) => {
  const origin = (
    (source.document as { $extensions?: Record<string, unknown> })
      .$extensions?.[DTF_KEY] as
      { tokensStudio?: { order: string[] } } | undefined
  )?.tokensStudio;
  const used = new Set(
    source.tokens.map(
      (token) =>
        (
          (token.$extensions?.[DTF_KEY] as Record<string, unknown> | undefined)
            ?.tokensStudio as { set?: string } | undefined
        )?.set
    )
  );

  return (
    origin?.order.filter((name) => used.has(name)).at(-1) ??
    origin?.order.at(-1) ??
    'global'
  );
};

/**
 * Opens the `#export` dialog for the tokens.
 *
 * @param {ExportSource} source The tokens to export
 * @param {(message: string) => void} announce Says what happened, for screen readers too
 */
export const openExportDialog = (
  source: ExportSource,
  announce: (message: string) => void
) => {
  const dialog = document.querySelector('#export') as HTMLDialogElement;
  const formats = [
    ...dialog.querySelectorAll<HTMLInputElement>('input[name="export-format"]')
  ];
  const setField = dialog.querySelector('#export-set-field') as HTMLElement;
  const setInput = dialog.querySelector('#export-set') as HTMLInputElement;
  const nameInput = dialog.querySelector('#export-name') as HTMLInputElement;
  const note = dialog.querySelector('#export-note') as HTMLElement;
  const preview = dialog.querySelector('#export-preview') as HTMLElement;
  const copy = dialog.querySelector('#export-copy') as HTMLButtonElement;
  const download = dialog.querySelector(
    '#export-download'
  ) as HTMLButtonElement;
  const format = () =>
    (formats.find((input) => input.checked)?.value ?? 'dtcg') as
      'dtcg' | 'tokens-studio';

  let text = '';

  const update = (rename = false) => {
    const studio = format() === 'tokens-studio';

    setField.hidden = !studio;

    if (rename)
      nameInput.value = studio ? 'tokens.json' : 'design-tokens.tokens.json';

    try {
      text = exportText(source, format(), setInput.value.trim());
    } catch (error) {
      text = '';
      preview.textContent = `These tokens can't be exported as ${studio ? 'Tokens Studio' : 'DTCG'}: ${(error as Error).message}`;
      download.disabled = copy.disabled = true;

      return;
    }

    download.disabled = copy.disabled = false;

    const lines = text.split('\n');

    preview.textContent =
      lines.length > PREVIEW_LINES
        ? `${lines.slice(0, PREVIEW_LINES).join('\n')}\n… ${lines.length - PREVIEW_LINES} more lines`
        : text;
    note.textContent = `${source.tokens.length} tokens${source.earlier ? ', your last version without problems: your latest edits have problems' : ''}.`;
    download.textContent = `Download ${nameInput.value || 'tokens.json'}`;
  };
  const onFormat = () => update(true);
  const onInput = () => update();
  const onCopy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        copy.textContent = 'Copied';
        announce('Copied the JSON');
      })
      .catch(() => announce('Your browser did not allow copying'));
  };
  const onDownload = () => {
    const url = URL.createObjectURL(
      new Blob([`${text}\n`], { type: 'application/json' })
    );
    const link = document.createElement('a');
    const fileName = nameInput.value.trim() || 'tokens.json';

    link.href = url;
    link.download = fileName;
    link.click();
    // After the browser has started the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(`Downloaded ${fileName}: ${source.tokens.length} tokens`);
  };

  formats.forEach((input) => input.addEventListener('change', onFormat));
  setInput.addEventListener('input', onInput);
  nameInput.addEventListener('input', onInput);
  copy.addEventListener('click', onCopy);
  download.addEventListener('click', onDownload);
  dialog.addEventListener(
    'close',
    () => {
      formats.forEach((input) => input.removeEventListener('change', onFormat));
      setInput.removeEventListener('input', onInput);
      nameInput.removeEventListener('input', onInput);
      copy.removeEventListener('click', onCopy);
      download.removeEventListener('click', onDownload);
    },
    { once: true }
  );

  setInput.value = defaultSet(source);
  copy.textContent = 'Copy JSON';
  update(true);
  dialog.showModal();
};
