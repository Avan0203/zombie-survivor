import { readFile, writeFile } from 'node:fs/promises';
const p = 'src/game/Game.ts';
let t = await readFile(p, 'utf8');
const a = '  groundTexture.repeat.set(5.5, 3.5);';
if (!t.includes(a)) throw new Error('missing ground repeat');
await writeFile(p, t.replace(a, '  groundTexture.repeat.set(8.5, 5.4);'));
console.log('ground repeat ok');
