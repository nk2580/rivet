import {createCharacter} from '../../src/domain/character';

export function castingCharacter(edition: '5e-2014' | '5e-2024' = '5e-2024') {
  const c = createCharacter('Casting fixture', edition);
  c.hp = c.maxHp = 48;
  c.slots = [{level: 1, maximum: 4, spent: 0}, {level: 3, maximum: 2, spent: 0}, {level: 4, maximum: 1, spent: 0}];
  c.spells = [
    {id: 'guardians', name: 'Spirit Guardians', level: 3, castingTime: 'Action', range: 'Self', concentration: true, prepared: true, notes: ''},
    {id: 'bless', name: 'Bless', level: 1, castingTime: 'Action', range: '30 ft', concentration: true, prepared: true, notes: ''},
    {id: 'bolt', name: 'Guiding Bolt', level: 1, castingTime: 'Action', range: '120 ft', concentration: false, prepared: true, notes: ''},
    {id: 'guidance', name: 'Guidance', level: 0, castingTime: 'Action', range: 'Touch', concentration: true, prepared: true, notes: ''},
  ];
  return c;
}
