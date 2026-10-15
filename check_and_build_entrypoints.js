const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROJECT_ROOT = __dirname;
const HASH_FILE = path.join(PROJECT_ROOT, '.python_build_hash');

function getPythonFiles(projectRoot = PROJECT_ROOT) {
  return fs.readdirSync(projectRoot)
    .filter(file => file.endsWith('.py'))
    .sort();
}

function hasMainEntrypoint(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return /if\s+__name__\s*==\s*['\"]__main__['\"]\s*:/.test(content);
  } catch (e) {
    return false;
  }
}

function getBuildTargets(projectRoot = PROJECT_ROOT) {
  return getPythonFiles(projectRoot).filter(file => hasMainEntrypoint(path.join(projectRoot, file)));
}

function executableNameFromScript(scriptName, windows) {
  const baseName = path.basename(scriptName, '.py');
  return windows ? `${baseName}.exe` : baseName;
}

function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

function getCurrentHash() {
  const buildInputs = [...getPythonFiles(), 'requirements.txt', 'build_entrypoints.bat',
    'build_entrypoints.sh', 'check_and_build_entrypoints.js'];
  const hashes = buildInputs.map(file => {
    const hash = getFileHash(path.join(PROJECT_ROOT, file));
    return `${file}:${hash}`;
  }).join('|');
  return crypto.createHash('md5').update(hashes).digest('hex');
}

function getSavedHash() {
  try {
    return fs.readFileSync(HASH_FILE, 'utf8').trim();
  } catch (e) {
    return null;
  }
}

function saveHash(hash) {
  fs.writeFileSync(HASH_FILE, hash);
}

function verifyBinaries({ platform = process.platform, binDir = path.join(PROJECT_ROOT, 'GUI', 'bin') } = {}) {
  const missing = getBuildTargets()
    .map(script => executableNameFromScript(script, platform === 'win32'))
    .filter(file => !fs.existsSync(path.join(binDir, file)));
  if (missing.length) {
    throw new Error(`Missing Python executables in ${binDir}: ${missing.join(', ')}. ` +
      'Run npm run build:entrypoints && npm run copy:entrypoints from the project root before packaging.');
  }
}

function copyEntrypoints() {
  // Validate all sources before copying so a failed build cannot silently stage
  // an incomplete set of executables.
  verifyBinaries({ binDir: PROJECT_ROOT });
  const binDir = path.join(PROJECT_ROOT, 'GUI', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const script of getBuildTargets()) {
    const file = executableNameFromScript(script, process.platform === 'win32');
    fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(binDir, file));
    console.log(`Copied ${file} to GUI/bin/`);
  }
}

function buildAndCopy() {
  console.log('Python entrypoint files changed. Building entrypoint executables...');
  
  const buildCmd = process.platform === 'win32' 
    ? 'build_entrypoints.bat' 
    : './build_entrypoints.sh';
  
  execSync(buildCmd, { stdio: 'inherit', cwd: PROJECT_ROOT });
  copyEntrypoints();
}

function main() {
  if (process.argv[2] === '--list-targets') {
    console.log(getBuildTargets().join('\n'));
    return;
  }
  if (process.argv[2] === '--copy') {
    copyEntrypoints();
    return;
  }
  const targetScripts = getBuildTargets();
  if (targetScripts.length === 0) {
    console.log('No top-level Python entrypoint scripts found to build.');
    return;
  }

  const currentHash = getCurrentHash();
  const savedHash = getSavedHash();
  
  // Check if executables exist
  const exeNames = targetScripts.map(script => executableNameFromScript(script, process.platform === 'win32'));
  const exesExist = exeNames.every(file => fs.existsSync(path.join(PROJECT_ROOT, file)));
  
  if (!exesExist) {
    console.log('One or more executables not found. Building...');
    buildAndCopy();
    saveHash(currentHash);
  } else if (currentHash !== savedHash) {
    buildAndCopy();
    saveHash(currentHash);
  } else {
    console.log('Python files unchanged. Skipping build.');
    console.log('Using existing Python executables.');
    // GUI/bin may have been removed or contain an older copy, even if the
    // executables in the project root are current.
    copyEntrypoints();
  }
}

module.exports = { getBuildTargets, executableNameFromScript, verifyBinaries };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
