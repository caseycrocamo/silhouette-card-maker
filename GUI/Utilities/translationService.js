'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createTranslationService(dependencies = {}) {
  const io = dependencies.fs || fs;
  const launch = dependencies.spawn || spawn;
  const platform = dependencies.platform || process.platform;
  const projectRoot = dependencies.projectRoot || path.resolve(__dirname, '../..');
  const app = dependencies.app || require('electron').app;
  const constants = dependencies.constants || require('../shared/constants');
  const getOutputDir = dependencies.getOutputDir || constants.getOutputDir;
  const getLayoutEnvironment = dependencies.getLayoutEnvironment || constants.getLayoutEnvironment;
  const resourcesPath = dependencies.resourcesPath || process.resourcesPath;
  const temporaryRoot = dependencies.temporaryRoot || os.tmpdir();

  async function run(options = {}) {
    if (typeof options.markdownText !== 'string' || !options.markdownText.trim()) throw new Error('Markdown input is empty.');
    if (Buffer.byteLength(options.markdownText, 'utf8') > 2 * 1024 * 1024) throw new Error('Markdown input must be smaller than 2 MB.');
    const ppi = options.ppi ?? 300;
    const quality = options.quality ?? 75;
    if (!Number.isSafeInteger(ppi) || ppi < 1) throw new Error('PPI must be a positive whole number.');
    if (!Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('Quality must be a whole number from 0 to 100.');
    const paperSize = options.paperSize ?? 'letter';
    if (typeof paperSize !== 'string' || !paperSize.trim() || paperSize.includes('\0')) throw new Error('Choose a configured paper size.');
    const outputPath = options.outputPath ?? path.join(getOutputDir(), 'translatedTextBoxes.pdf');
    if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || outputPath.includes('\0') || path.extname(outputPath).toLowerCase() !== '.pdf') throw new Error('Choose an absolute PDF output path.');
    const baseDir = app.isPackaged ? path.join(resourcesPath, 'bin') : path.join(projectRoot, 'GUI/bin');
    const executable = path.join(baseDir, `translated_text_boxes_to_pdf${platform === 'win32' ? '.exe' : ''}`);
    let command = executable, prefix = [], cwd = baseDir;
    if (!io.existsSync(executable)) {
      if (app.isPackaged) throw new Error('The translation executable is missing. Reinstall the app.');
      const script = path.join(projectRoot, 'translated_text_boxes_to_pdf.py');
      const candidates = ['venv', '.venv'].map(dir => platform === 'win32' ? path.join(projectRoot, dir, 'Scripts/python.exe') : path.join(projectRoot, dir, 'bin/python'));
      command = candidates.find(candidate => io.existsSync(candidate));
      if (!command || !io.existsSync(script)) throw new Error('Cannot find the translation script or project Python environment.');
      prefix = [script]; cwd = projectRoot;
    } else if (platform !== 'win32') {
      io.chmodSync(executable, 0o755);
    }
    // Layout choices are loaded when Python imports the CLI module.
    const env = { ...process.env, ...getLayoutEnvironment(), CARD_MAKER_OUTPUT_DIR: getOutputDir() };
    const temporary = await io.promises.mkdtemp(path.join(temporaryRoot, 'card-translation-'));
    let stagedDirectory;
    try {
      const inputPath = path.join(temporary, 'entries.md');
      await io.promises.writeFile(inputPath, options.markdownText, 'utf8');
      await io.promises.mkdir(path.dirname(outputPath), { recursive: true });
      // A sibling staging file keeps replacement on the same filesystem.
      // The selected PDF is untouched until conversion and signature checks pass.
      stagedDirectory = await io.promises.mkdtemp(path.join(path.dirname(outputPath), '.card-translation-'));
      const stagedOutput = path.join(stagedDirectory, 'result.pdf');
      const args = [...prefix, '--input_path', inputPath, '--output_path', stagedOutput, '--paper_size', paperSize, '--ppi', String(ppi), '--quality', String(quality)];
      const log = await new Promise((resolve, reject) => {
        const child = launch(command, args, { shell: false, cwd, env });
        let stdout = '', stderr = '';
        child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-1_000_000); });
        child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-1_000_000); });
        child.once('error', error => reject(new Error(`Cannot start translation: ${error.message}`)));
        child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Translation exited with code ${code}.`)));
      });
      if (!io.existsSync(stagedOutput)) throw new Error('Translation completed without creating a PDF.');
      const output = await io.promises.open(stagedOutput, 'r');
      try {
        const stat = await output.stat();
        const header = Buffer.alloc(5), tail = Buffer.alloc(Math.min(1024, stat.size));
        await output.read(header, 0, header.length, 0);
        await output.read(tail, 0, tail.length, Math.max(0, stat.size - tail.length));
        if (!stat.isFile() || header.toString('ascii') !== '%PDF-' || !/%%EOF\s*$/.test(tail.toString('latin1')))
          throw new Error('Translation did not create a complete PDF.');
      } finally { await output.close(); }
      await io.promises.rename(stagedOutput, outputPath);
      return { outputPath, log: log.split(stagedOutput).join(outputPath) };
    } finally {
      await Promise.all([
        io.promises.rm(temporary, { recursive: true, force: true }),
        stagedDirectory ? io.promises.rm(stagedDirectory, { recursive: true, force: true }) : Promise.resolve(),
      ]);
    }
  }
  return { run };
}
module.exports = { createTranslationService };
