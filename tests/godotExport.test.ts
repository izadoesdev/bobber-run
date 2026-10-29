import { describe, expect, it } from 'bun:test';
import { godotJson } from '../scripts/godot-json';

describe('portable Godot exports', () => {
  it('canonicalizes the observed ARM64 and x64 fish-size differences', () => {
    const arm = { look: { size: 0.6645531953674049, space: 11.696136238466327, body: 7.310085149041454 } };
    const x64 = { look: { size: 0.6645531953674048, space: 11.696136238466323, body: 7.310085149041452 } };
    expect(godotJson(arm)).toBe(godotJson(x64));
    expect(JSON.parse(godotJson(arm))).toEqual({ look: { size: 0.664553195367, space: 11.6961362385, body: 7.31008514904 } });
  });

  it('preserves integer prices, flags, text, arrays, and very small fractions', () => {
    const data = { price: 50, seed: 4294967295, max: Number.MAX_SAFE_INTEGER, values: [null, true, '#efe9dc', 0, 0.000001] };
    const json = godotJson(data, 1);
    expect(JSON.parse(json)).toEqual(data);
    expect(json).toContain('\n "price": 50,');
    expect(json.endsWith('\n')).toBe(true);
  });

  it('does not change the source values', () => {
    const source = { look: { body: 7.310085149041454 } };
    godotJson(source);
    expect(source.look.body).toBe(7.310085149041454);
  });
});
