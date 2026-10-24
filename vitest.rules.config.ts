import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'node',include:['tests/**/*.integration.ts'],setupFiles:['./tests/setup.ts'],testTimeout:20000,hookTimeout:30000,fileParallelism:false}});
