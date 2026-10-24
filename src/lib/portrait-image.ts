import {PORTRAIT_SIZE, portraitSchema, validatePortraitFile, type CharacterPortrait} from '@/domain/portrait';

/** Store a bounded local raster, independent of the source file's path or lifetime. */
export async function readPortraitFile(file: File): Promise<CharacterPortrait> {
  validatePortraitFile(file);
  let bitmap: ImageBitmap;
  try {bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});}
  catch {throw new Error('That image could not be read. Choose another PNG, JPEG or WebP.');}
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 24000000) throw new Error('Choose an image with no more than 24 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PORTRAIT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The portrait preview could not be created. Try again.');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    return portraitSchema.parse({dataUrl: canvas.toDataURL('image/webp', .9)});
  } finally {bitmap.close();}
}
