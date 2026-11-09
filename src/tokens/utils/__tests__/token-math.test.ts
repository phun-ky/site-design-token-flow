import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateMath, isMath } from '../token-math';

describe('evaluateMath', () => {
  it('works out Tokens Studio math, keeping the unit', () => {
    assert.deepEqual(evaluateMath('8px * 2'), { value: 16, unit: 'px' });
    assert.deepEqual(evaluateMath('2 * 8px + 4px'), { value: 20, unit: 'px' });
    assert.deepEqual(evaluateMath('(8 + 4) / 2'), { value: 6, unit: '' });
    assert.deepEqual(evaluateMath('1.5rem - .25rem'), {
      value: 1.25,
      unit: 'rem'
    });
    assert.deepEqual(evaluateMath('-4px * -1'), { value: 4, unit: 'px' });
    assert.deepEqual(evaluateMath('0.1 + 0.2'), { value: 0.3, unit: '' });
    assert.deepEqual(evaluateMath('16px / 4px'), { value: 4, unit: '' });
    assert.deepEqual(evaluateMath('150% * 2'), { value: 300, unit: '%' });
  });

  it('works out the functions', () => {
    assert.deepEqual(evaluateMath('roundTo(10px / 3)'), {
      value: 3,
      unit: 'px'
    });
    assert.deepEqual(evaluateMath('roundTo(10 / 3, 2)'), {
      value: 3.33,
      unit: ''
    });
    assert.deepEqual(evaluateMath('max(4px, 2px * 3)'), {
      value: 6,
      unit: 'px'
    });
    assert.deepEqual(evaluateMath('floor(1.9) + ceil(0.1) + abs(-1)'), {
      value: 3,
      unit: ''
    });
  });

  it('refuses mixed units, and what it cannot read', () => {
    assert.throws(
      () => evaluateMath('8px + 1rem'),
      /Mixed units "px" and "rem"/
    );
    assert.throws(
      () => evaluateMath('8px * 2px'),
      /Can't multiply two lengths/
    );
    assert.throws(() => evaluateMath('8 / 0'), /Division by zero/);
    assert.throws(() => evaluateMath('alert(1)'), /Unknown function "alert"/);
    assert.throws(() => evaluateMath('8 * '), /Unexpected end/);
    assert.throws(() => evaluateMath('(8 * 2'), /Expected "\)"/);
    assert.throws(() => evaluateMath('8 # 2'), /Unexpected "#"/);
    assert.throws(() => evaluateMath('8 2'), /Unexpected/);
    assert.throws(() => evaluateMath(''), /Empty math/);
  });
});

describe('isMath', () => {
  it('tells math from plain values', () => {
    assert.equal(isMath('8px * 2'), true);
    assert.equal(isMath('roundTo(3.3)'), true);
    assert.equal(isMath('(4)+1'), true);
    assert.equal(isMath('16px'), false);
    assert.equal(isMath('-4px'), false);
    assert.equal(isMath('#ff0000'), false);
    assert.equal(isMath('Inter, sans-serif'), false);
    assert.equal(isMath('rgb(51, 102, 204)'), false);
    assert.equal(isMath('hsl(0, 0%, 50%)'), false);
  });
});
