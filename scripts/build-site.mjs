import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
const output = new URL('../dist-site/', import.meta.url);
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
for (const name of ['index.html', '404.html', 'styles.css', 'site.js', 'assets']) {
  await cp(new URL('../website/' + name, import.meta.url), new URL(name, output), {recursive: true});
}
await writeFile(new URL('.nojekyll', output), '');
console.log('Built static GitHub Pages site in dist-site/');
