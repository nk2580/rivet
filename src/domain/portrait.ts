import {z} from 'zod';

export const PORTRAIT_SIZE = 512;
export const MAX_PORTRAIT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PORTRAIT_DATA_LENGTH = 800000;
export const PORTRAIT_PROMPT_LIMIT = 1000;
export const portraitSchema = z.object({
  dataUrl: z.string().max(MAX_PORTRAIT_DATA_LENGTH).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, 'Choose a PNG, JPEG or WebP portrait.'),
});
export type CharacterPortrait = z.infer<typeof portraitSchema>;

export function portraitPrompt(character: {name: string; species: string; classes: {name: string}[]}) {
  const concise = (text: string, limit: number) => text.replace(/\s+/g, ' ').trim().slice(0, limit);
  const name = concise(character.name, 80);
  const identity = [concise(character.species, 60), concise([...new Set(character.classes.map(item => item.name))].join(' / '), 100)].filter(Boolean).join(' ');
  return `Square fantasy portrait of ${name}${identity ? `, ${identity}` : ''}. Head and shoulders, painterly realism, soft lighting, simple background, no text.`;
}

export function validatePortraitFile(file: {type: string; size: number}) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (!file.size) throw new Error('That image is empty. Choose another file.');
  if (file.size > MAX_PORTRAIT_FILE_BYTES) throw new Error('Choose an image smaller than 10 MB.');
}
