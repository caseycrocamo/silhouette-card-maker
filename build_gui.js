const path = require('path');
const { execSync } = require('child_process');

function getGuiBuildScript(platform = process.platform) {
  const scripts = { win32: 'dist:win', darwin: 'dist:mac', linux: 'dist:linux' };
  if (!scripts[platform]) throw new Error(`Unsupported build platform: ${platform}`);
  return scripts[platform];
}

module.exports = { getGuiBuildScript };

if (require.main === module) {
  execSync(`npm run ${getGuiBuildScript()}`, {
    cwd: path.join(__dirname, 'GUI'), stdio: 'inherit'
  });
}
