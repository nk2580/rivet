import {z} from 'zod';

export const mainColours=[
  {id:'crimson',name:'Crimson',swatch:'oklch(.55 .16 22)'},
  {id:'amber',name:'Amber',swatch:'oklch(.55 .11 70)'},
  {id:'forest',name:'Forest',swatch:'oklch(.55 .12 152)'},
  {id:'teal',name:'Teal',swatch:'oklch(.55 .09 190)'},
  {id:'sapphire',name:'Sapphire',swatch:'oklch(.55 .16 255)'},
  {id:'violet',name:'Violet',swatch:'oklch(.55 .16 300)'},
] as const;
export type MainColour=typeof mainColours[number]['id'];
export const appearanceSchema=z.object({
  theme:z.enum(['system','light','dark']),
  mainColour:z.enum(['crimson','amber','forest','teal','sapphire','violet']),
}).strict();
export type Appearance=z.infer<typeof appearanceSchema>;
export type Theme=Appearance['theme'];
export type ResolvedTheme='light'|'dark';
export type AppearanceState=Appearance&{resolvedTheme:ResolvedTheme};
export type AppearanceCommand={action:'get'}|{action:'set';value:Appearance};
export const appearanceCommandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('get')}).strict(),
  z.object({action:z.literal('set'),value:appearanceSchema}).strict(),
]);
export const resolveAppearance=(appearance:Appearance,systemDark:boolean):AppearanceState=>({...appearance,resolvedTheme:appearance.theme==='system'?(systemDark?'dark':'light'):appearance.theme});
