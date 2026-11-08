"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const isImage = (name) => /\.(png|jpe?g|webp)$/i.test(name);
async function exportImages({
  plan,
  mode = "add",
  frontDir,
  doubleSidedDir,
  loadImage,
  fileSystem = fs,
}) {
  const io = fileSystem;
  if (!["add", "replace", "cancel"].includes(mode))
    throw new Error("Invalid image action.");
  if (mode === "cancel") return { cancelled: true };
  if (!Array.isArray(plan) || !plan.length)
    throw new Error("No ready cards to export.");
  for (const dir of [frontDir, doubleSidedDir])
    io.mkdirSync(dir, { recursive: true });
  const stage = io.mkdtempSync(
    path.join(path.dirname(frontDir), ".card-export-"),
  );
  const pending = [],
    backups = [],
    written = [];
  const batch = crypto.randomBytes(6).toString("hex");
  try {
    for (let i = 0; i < plan.length; i++) {
      const job = plan[i];
      const name =
        String(job.name || "card")
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 80) || "card";
      const filename = `${String(i + 1).padStart(5, "0")}-${batch}-${name}.png`;
      for (const [face, dir] of [
        [job.front, frontDir],
        [job.back, doubleSidedDir],
      ]) {
        if (!face) {
          if (dir === frontDir) throw new Error("Card has no front image.");
          continue;
        }
        const buffer = await loadImage(face);
        if (!Buffer.isBuffer(buffer) || !buffer.length)
          throw new Error("Invalid card image.");
        const staged = path.join(stage, `${pending.length}.png`);
        io.writeFileSync(staged, buffer);
        pending.push({ staged, target: path.join(dir, filename) });
      }
    }
    if (mode === "replace")
      for (const dir of [frontDir, doubleSidedDir])
        for (const file of io.readdirSync(dir).filter(isImage)) {
          const original = path.join(dir, file);
          if (!io.lstatSync(original).isFile()) continue;
          const backup = path.join(stage, `backup-${backups.length}`);
          io.renameSync(original, backup);
          backups.push({ original, backup });
        }
    for (const item of pending) {
      io.copyFileSync(item.staged, item.target, io.constants.COPYFILE_EXCL);
      written.push(item.target);
    }
    return { count: plan.length, files: written.length };
  } catch (error) {
    for (const file of written) io.rmSync(file, { force: true });
    for (const b of backups) io.renameSync(b.backup, b.original);
    throw error;
  } finally {
    io.rmSync(stage, { recursive: true, force: true });
  }
}
module.exports = { exportImages, isImage };
