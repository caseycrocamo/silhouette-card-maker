const minimumMajor = 22;

if (Number(process.versions.node.split('.')[0]) < minimumMajor) {
  console.error(
    `Node.js ${process.versions.node} is too old. This build requires Node.js ${minimumMajor} or newer.\n` +
    'Use Node.js 22: run "nvm install" and "nvm use" from the project root, then retry the build.'
  );
  process.exitCode = 1;
}
