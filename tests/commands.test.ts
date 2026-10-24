import { describe, expect, it } from 'vitest';
import { createCharacter } from '../src/domain/character';
import { applyCharacterCommand } from '../src/domain/commands';

describe('edition-specific state changes without a dice system', () => {
  it('absorbs damage with temporary HP and leaves the input immutable', () => {
    const c = createCharacter('Torren', '5e-2024'); c.hp = c.maxHp = 48; c.tempHp = 8;
    const result = applyCharacterCommand(c, {type: 'damage', amount: 25});
    expect(result.character.hp).toBe(31); expect(result.character.tempHp).toBe(0); expect(c.hp).toBe(48);
  });
  it('does not apply the 2024 concentration DC cap to 2014 characters', () => {
    for (const edition of ['5e-2014', '5e-2024'] as const) {
      const c = createCharacter('Cleric', edition); c.hp = c.maxHp = 200; c.concentration = 'Bless';
      expect(applyCharacterCommand(c, {type: 'damage', amount: 80}).reminders[0]).toContain(edition === '5e-2014' ? 'DC 40' : 'DC 30');
    }
  });
  it('permits negative HP in 3.5e and stops fifth-edition HP at zero', () => {
    expect(applyCharacterCommand(createCharacter('Fighter', '3.5e'), {type: 'damage', amount: 14}).character.hp).toBe(-4);
    expect(applyCharacterCommand(createCharacter('Fighter', '5e-2014'), {type: 'damage', amount: 14}).character.hp).toBe(0);
  });
  it('rejects invalid amounts and exhausted resources', () => {
    const c = createCharacter('Cleric', '5e-2024');
    c.resources = [{id: 'channel', name: 'Channel Divinity', maximum: 2, spent: 2, reset: 'long', shortRecovery: 0}];
    expect(() => applyCharacterCommand(c, {type: 'resource', resourceId: 'channel', change: 1})).toThrow();
    expect(() => applyCharacterCommand(c, {type: 'damage', amount: -1})).toThrow();
  });
});
