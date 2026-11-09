// Publica dist/ en la rama gh-pages del remoto "origin" (GitHub Pages "deploy from branch").
// Usa un repositorio git temporal dentro de dist/ para no tocar la rama de trabajo.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

const run = (cmd, cwd = '.') => execSync(cmd, { cwd, stdio: 'inherit' });
const remote = execSync('git remote get-url origin').toString().trim();

if (!existsSync('dist/index.html')) throw new Error('Falta dist/: ejecuta npm run build');
writeFileSync('dist/.nojekyll', ''); // GitHub Pages no debe procesar los ficheros con Jekyll
rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git -c user.name="OposiTest deploy" -c user.email="deploy@localhost" commit -q -m "Publicar versión"', 'dist');
run(`git push -q -f ${remote} gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('Publicado en la rama gh-pages.');
