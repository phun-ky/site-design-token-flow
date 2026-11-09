/**
 * Token files you load into the playground, from your computer. They are read
 * in the browser and never uploaded.
 */

/**
 * The largest file the playground loads. Browsers keep about 5 MB per site,
 * and the playground saves your tokens twice: as you edit them, and their last
 * version without problems.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** A size in kB or MB, for messages */
export const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Why a file can't be loaded, or null when it can. Whether it is valid JSON
 * and valid tokens is for the playground's validation to say, as for text you
 * type.
 *
 * @param {{ name: string; size: number }} file The file's name and size in bytes
 * @param {string} [text] Its contents, once read
 * @returns {string | null} The reason, naming the file, or null
 * @example
 * refuseTokenFile({ name: 'logo.png', size: 2048 }, '\u0089PNG\u0000…');
 * // => '"logo.png" is not a text file: load a .json token file.'
 */
export const refuseTokenFile = (
  { name, size }: { name: string; size: number },
  text?: string
): string | null => {
  if (size > MAX_FILE_BYTES)
    return `"${name}" (${formatBytes(size)}) is too large: the playground keeps token files up to ${formatBytes(MAX_FILE_BYTES)} in your browser.`;

  // Text files have no NUL characters; images, archives and other binary
  // files nearly always do
  if (text?.includes('\u0000'))
    return `"${name}" is not a text file: load a .json token file.`;

  return null;
};
