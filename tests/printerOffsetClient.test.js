const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  const requests = [];
  let pending = '';
  child.stdin.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) if (line) requests.push(JSON.parse(line));
  });
  const filename = path.resolve(__dirname, '../GUI/Utilities/pdfWorkerClient.js');
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), process, console,
    setTimeout, clearTimeout,
    require(name) {
      if (name === 'child_process') return { spawn: () => child };
      if (name === '../shared/constants') return {
        getFrontDir: () => '/front', getBackDir: () => '/back', getOutputDir: () => '/output',
        getDoubleSidedDir: () => '/duplex', getDataDir: () => '/data', getLayoutEnvironment: () => ({})
      };
      if (name === 'electron') return { app: { isPackaged: false } };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return { client: context.module.exports, requests, child };
}

test('offset helper forwards output path, PPI, fractional offsets, and save choice', async () => {
  const { client, requests, child } = fixture();
  const result = client.runOffsetPdf({
    pdfPath: '/資料/input.pdf', outputPdfPath: '/資料/output.pdf', xOffset: -0.5,
    yOffset: 0, angle: -0.25, ppi: 600, save: false
  });
  child.stdout.write('{"ready":true}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[0], {
    command: 'offset_pdf', pdf_path: '/資料/input.pdf', output_pdf_path: '/資料/output.pdf',
    x_offset: -0.5, y_offset: 0, angle: -0.25, ppi: 600, save: false
  });
  child.stdout.write('{"ok":true}\n');
  await result;
});

test('calibration helper forwards selected sizes, output folder, and PPI', async () => {
  const { client, requests, child } = fixture();
  const result = client.generateCalibrationSheets({ paperSizes: ['letter', 'custom'], outputDir: '/tmp/output', ppi: 150 });
  child.stdout.write('{"ready":true}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[0], {
    command: 'generate_calibration', paper_sizes: ['letter', 'custom'], output_dir: '/tmp/output', ppi: 150
  });
  child.stdout.write('{"ok":true}\n');
  await result;
});
