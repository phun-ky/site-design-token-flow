import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_FILE_BYTES, formatBytes, refuseTokenFile } from '../token-file';

describe('refuseTokenFile', () => {
  it('accepts a text file up to the limit, whatever its contents', () => {
    assert.equal(refuseTokenFile({ name: 'a.json', size: 10 }, '{}'), null);
    assert.equal(
      refuseTokenFile({ name: 'a.json', size: MAX_FILE_BYTES }, 'not json'),
      null
    );
    assert.equal(refuseTokenFile({ name: 'a.json', size: 10 }), null);
  });

  it('refuses a file that is too large, before reading it', () => {
    assert.equal(
      refuseTokenFile({ name: 'big.json', size: 3 * 1024 * 1024 }),
      '"big.json" (3.0 MB) is too large: the playground keeps token files up to 2.0 MB in your browser.'
    );
    assert.notEqual(
      refuseTokenFile({ name: 'big.json', size: MAX_FILE_BYTES + 1 }),
      null
    );
  });

  it('refuses a file that is not text', () => {
    assert.equal(
      refuseTokenFile(
        { name: 'logo.png', size: 2048 },
        '\u0089PNG\u0000\u0001'
      ),
      '"logo.png" is not a text file: load a .json token file.'
    );
  });
});

describe('formatBytes', () => {
  it('shows kB below a megabyte, and MB from there', () => {
    assert.equal(formatBytes(10), '1 kB');
    assert.equal(formatBytes(12_800), '13 kB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  });
});
