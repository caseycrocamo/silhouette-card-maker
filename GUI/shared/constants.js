const path = require('path');

// Directory paths
const GAME_DIR = path.join(__dirname, '../../game');
const FRONT_DIR = path.join(GAME_DIR, 'front');
const BACK_DIR = path.join(GAME_DIR, 'back');
const OUTPUT_DIR = path.join(GAME_DIR, 'output');
const DECKLIST_DIR = path.join(GAME_DIR, 'decklist');
const DOUBLE_SIDED_DIR = path.join(GAME_DIR, 'double_sided');
const DATA_DIR = path.join(__dirname, '../../data');
const CALIBRATION_DIR = path.join(__dirname, '../../calibration');


function getUserDataDir(subdir) {
    if (!process.versions.electron) return null;

    const { app, ipcRenderer } = require('electron');
    // defaultApp is undefined in packaged apps, not false. The renderer must
    // ask the main process because Electron no longer provides electron.remote.
    const userData = app
        ? (app.isPackaged ? app.getPath('userData') : null)
        : ipcRenderer.sendSync('get-user-data-dir');
    return userData ? path.join(userData, subdir) : null;
}

function getFrontDir() {
    return getUserDataDir('front') || FRONT_DIR;
}
function getBackDir() {
    return getUserDataDir('back') || BACK_DIR;
}
function getOutputDir() {
    return getUserDataDir('output') || OUTPUT_DIR;
}
function getDecklistDir() {
    return getUserDataDir('decklist') || DECKLIST_DIR;
}
function getDoubleSidedDir() {
    return getUserDataDir('double_sided') || DOUBLE_SIDED_DIR;
}
function getDataDir() {
    return getUserDataDir('data') || DATA_DIR;
}
function getCalibrationDir() {
    return getUserDataDir('data')
        ? path.join(process.resourcesPath, 'calibration')
        : CALIBRATION_DIR;
}

module.exports = {
    getFrontDir,
    getBackDir,
    getOutputDir,
    getDecklistDir,
    getDoubleSidedDir,
    getDataDir,
    getCalibrationDir,
};
