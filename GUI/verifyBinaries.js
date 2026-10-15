const { verifyBinaries } = require('../check_and_build_entrypoints');

// Check the target platform, which may differ from the host on cross-builds.
module.exports = context => verifyBinaries({ platform: context.electronPlatformName });
