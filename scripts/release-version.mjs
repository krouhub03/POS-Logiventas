#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// 1. Argumentos CLI
const args = process.argv.slice(2);
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}
const hasFlag = (flag) => args.includes(flag);

const type = getArg('--type', 'patch'); // 'patch' | 'minor' | 'major'
const targetVersion = getArg('--version', null);
const message = getArg('--message', null);
const shouldCommit = hasFlag('--commit');
const shouldPush = hasFlag('--push');

console.log('\x1b[36m%s\x1b[0m', '📦 [Metahabi POS] Iniciando automatización de versionado y changelog...');

// 2. Leer versión actual desde package.json
const pkgPath = path.join(repoRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;
console.log(`📌 Versión actual: v${currentVersion}`);

// 3. Calcular nueva versión
let newVersion = '';
if (targetVersion) {
  newVersion = targetVersion.replace(/^v/, '');
} else {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  if (type === 'major') newVersion = `${major + 1}.0.0`;
  else if (type === 'minor') newVersion = `${major}.${minor + 1}.0`;
  else newVersion = `${major}.${minor}.${patch + 1}`;
}
console.log('\x1b[32m%s\x1b[0m', `🚀 Nueva versión objetivo: v${newVersion} (${type})`);

// 4. Actualizar package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`  ✓ package.json actualizado a ${newVersion}`);

// 5. Actualizar src-tauri/tauri.conf.json
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  let tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
  tauriConf = tauriConf.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
  fs.writeFileSync(tauriConfPath, tauriConf, 'utf8');
  console.log(`  ✓ src-tauri/tauri.conf.json actualizado a ${newVersion}`);
}

// 6. Actualizar src-tauri/Cargo.toml
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoTomlPath)) {
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  cargoToml = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoTomlPath, cargoToml, 'utf8');
  console.log(`  ✓ src-tauri/Cargo.toml actualizado a ${newVersion}`);
}

// 7. Actualizar CHANGELOG.md
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const today = new Date().toISOString().split('T')[0];

if (fs.existsSync(changelogPath)) {
  let changelog = fs.readFileSync(changelogPath, 'utf8');
  const versionHeader = `## [${newVersion}]`;

  if (!changelog.includes(versionHeader)) {
    console.log('\x1b[33m%s\x1b[0m', `📝 Agregando sección para v${newVersion} en CHANGELOG.md...`);

    // Extraer commits recientes desde el último tag
    let commitLog = '';
    try {
      const lastTag = execSync('git tag --sort=-v:refname', { encoding: 'utf8' }).trim().split('\n')[0];
      if (lastTag) {
        commitLog = execSync(`git log "${lastTag}..HEAD" --pretty=format:"- %s"`, { encoding: 'utf8' }).trim();
      }
    } catch {
      // Ignorar fallos de git
    }

    const summaryLine = message ? `- ${message}` : '- Actualización y optimizaciones del sistema.';

    const newSection = [
      `## [${newVersion}] - ${today}`,
      '',
      '### Agregado',
      summaryLine,
      commitLog ? '\n### Cambios recientes\n' + commitLog : '',
      '',
      '---',
      '',
    ].filter(Boolean).join('\n');

    const splitMarker = '---';
    const firstDivider = changelog.indexOf(splitMarker);
    if (firstDivider !== -1) {
      const insertIdx = firstDivider + splitMarker.length;
      changelog = changelog.slice(0, insertIdx) + '\n\n' + newSection + '\n' + changelog.slice(insertIdx).trimStart();
    } else {
      changelog = changelog + '\n\n' + newSection;
    }

    fs.writeFileSync(changelogPath, changelog, 'utf8');
    console.log(`  ✓ CHANGELOG.md actualizado con la sección [${newVersion}]`);
  } else {
    console.log(`  ℹ La sección [${newVersion}] ya existe en CHANGELOG.md (preservada).`);
  }

  // 8. Generar .release-notes.md con el contenido exclusivo de esta versión
  const lines = fs.readFileSync(changelogPath, 'utf8').split('\n');
  let capturing = false;
  const notesLines = [];

  for (const line of lines) {
    if (line.startsWith(`## [${newVersion}]`)) {
      capturing = true;
      continue;
    }
    if (capturing && line.startsWith('## [')) {
      break;
    }
    if (capturing) {
      notesLines.push(line);
    }
  }

  let releaseNotes = notesLines.join('\n').trim();
  releaseNotes = releaseNotes.replace(/^---\s*$/gm, '').trim();

  fs.writeFileSync(path.join(repoRoot, '.release-notes.md'), releaseNotes + '\n', 'utf8');
  console.log('  ✓ Notas de versión extraídas en .release-notes.md');
}

// 9. Git commit & tag
if (shouldCommit) {
  console.log('\x1b[36m%s\x1b[0m', '🔨 Realizando Git commit y tag...');
  execSync('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md', { stdio: 'inherit' });

  const commitMsg = message ? `chore(release): v${newVersion} - ${message}` : `chore(release): bump version to v${newVersion}`;
  execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  console.log('\x1b[32m%s\x1b[0m', `✅ Tag v${newVersion} creado exitosamente.`);

  if (shouldPush) {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Empujando a origin main con tags...');
    execSync('git push origin main --tags', { stdio: 'inherit' });
    console.log('\x1b[32m%s\x1b[0m', '🎉 Release disparado en GitHub Actions!');
  } else {
    console.log('\x1b[33m%s\x1b[0m', '💡 Para compilar y publicar en GitHub, ejecuta: git push origin main --tags');
  }
} else {
  console.log('\x1b[32m%s\x1b[0m', `\n✨ Manifiestos sincronizados a v${newVersion}.`);
  console.log('\x1b[33m%s\x1b[0m', '   Revisa CHANGELOG.md y cuando estés listo ejecuta:');
  console.log(`   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md`);
  console.log(`   git commit -m "chore(release): v${newVersion} - ${message || 'actualización'}"`);
  console.log(`   git tag v${newVersion}`);
  console.log(`   git push origin main --tags`);
}
