import { buildRulesDatabase } from './rules';
import { resolve } from 'node:path';
const filename=resolve(process.argv[2]??'dist-electron/rules.sqlite'),directory=resolve(process.argv[3]??'public/rules');
console.log(`Indexed ${buildRulesDatabase(filename,directory)} source entries in ${filename}`);
