'use strict';

const https = require('https');
const semver = require('semver');

const OWNER = 'caseycrocamo';
const REPOSITORY = 'silhouette-card-maker';
const RELEASES_URL = `https://github.com/${OWNER}/${REPOSITORY}/releases`;
const API_ORIGIN = 'https://api.github.com';
const API_PATH = `/repos/${OWNER}/${REPOSITORY}/releases`;
const API_URL = `${API_ORIGIN}${API_PATH}?per_page=100`;
const MAX_RELEASE_PAGES = 10;

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^v/i, '');
  return semver.valid(normalized, { loose: false });
}

function findLatestStableRelease(releases, currentVersion) {
  const current = normalizeVersion(currentVersion);
  if (!current || !Array.isArray(releases)) return null;
  const candidates = releases
    .filter((release) => release && !release.draft && !release.prerelease)
    .map((release) => ({ release, version: normalizeVersion(release.tag_name) }))
    .filter(({ version }) => version && semver.prerelease(version) === null && semver.gt(version, current))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  if (!candidates.length) return null;
  const { release, version } = candidates[0];
  return {
    version,
    releaseNotes: typeof release.body === 'string' ? release.body : '',
    releaseUrl: RELEASES_URL,
    publishedAt: release.published_at || null,
    assets: Array.isArray(release.assets) ? release.assets : [],
  };
}

function expectedAssetNames(version, platform, arch, { appImage = false } = {}) {
  // electron-builder sanitizes the configured product name for artifact filenames.
  const stem = `Silhouette-Card-Maker-${version}-${platform}-${arch}`;
  if (platform === 'win') return [`${stem}.zip`];
  if (platform === 'mac') return [`${stem}.dmg`, `${stem}.zip`];
  if (platform === 'linux') return appImage ? [`${stem}.AppImage`, `${stem}.tar.gz`] : [`${stem}.tar.gz`, `${stem}.AppImage`];
  return [];
}

function findLatestCompatibleRelease(releases, currentVersion, platform, arch, options = {}) {
  const current = normalizeVersion(currentVersion);
  if (!current || !Array.isArray(releases)) return { release: null, hasNewerRelease: false };
  const stable = releases
    .filter((release) => release && !release.draft && !release.prerelease)
    .map((release) => ({ release, version: normalizeVersion(release.tag_name) }))
    .filter(({ version }) => version && semver.prerelease(version) === null && semver.gt(version, current))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  for (const item of stable) {
    const names = expectedAssetNames(item.version, platform, arch, options);
    const asset = (item.release.assets || []).find((candidate) => candidate && names.includes(candidate.name) && (!candidate.state || candidate.state === 'uploaded'));
    if (asset) return {
      release: {
        version: item.version,
        releaseNotes: typeof item.release.body === 'string' ? item.release.body : '',
        releaseUrl: RELEASES_URL,
        publishedAt: item.release.published_at || null,
        assetName: asset.name,
        assets: item.release.assets,
      },
      hasNewerRelease: true,
    };
  }
  return { release: null, hasNewerRelease: stable.length > 0 };
}

function nextPageFromLink(link) {
  if (typeof link !== 'string') return null;
  const nextPart = link.split(',').find((part) => /;\s*rel="next"/.test(part));
  if (!nextPart) return null;
  const match = nextPart.match(/<([^>]+)>/);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (url.origin !== API_ORIGIN || url.pathname !== API_PATH) return null;
    if ([...url.searchParams.keys()].some((key) => !['page', 'per_page'].includes(key))) return null;
    if (url.searchParams.get('per_page') !== '100' || !/^\d+$/.test(url.searchParams.get('page') || '')) return null;
    return url.href;
  } catch (_) { return null; }
}

function requestReleasePage(url, { request, timeoutMs, now }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    let req;
    try {
      req = request(url, {
        headers: { 'User-Agent': 'Silhouette-Card-Maker-Updater', Accept: 'application/vnd.github+json' },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { req.destroy(new Error('Release response was too large')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode === 403 || res.statusCode === 429) {
            const reset = Number(res.headers && res.headers['x-ratelimit-reset']);
            const retryHeader = res.headers && res.headers['retry-after'];
            const retrySeconds = Number(retryHeader);
            const retryDate = typeof retryHeader === 'string' ? Date.parse(retryHeader) : NaN;
            const retryDelay = retrySeconds > 0 ? retrySeconds * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - now()) : 0;
            const delay = retryDelay || (reset > now() / 1000 ? reset * 1000 - now() : 0);
            const error = new Error('GitHub release service is rate limited');
            error.retryAfterMs = Math.min(delay || 60_000, 24 * 60 * 60 * 1000);
            finish(reject, error);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) { finish(reject, new Error(`Release service returned HTTP ${res.statusCode}`)); return; }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!Array.isArray(parsed)) throw new Error('Release service returned invalid data');
            finish(resolve, { releases: parsed, next: nextPageFromLink(res.headers && res.headers.link) });
          } catch (error) { finish(reject, error); }
        });
        res.on('aborted', () => finish(reject, new Error('Release response was interrupted')));
        res.on('error', (error) => finish(reject, error));
      });
    } catch (error) { finish(reject, error); return; }
    req.on('error', (error) => finish(reject, error));
    req.on('timeout', () => req.destroy(new Error('Release request timed out')));
  });
}

async function requestReleases({ request = https.get, timeoutMs = 8000, now = Date.now } = {}) {
  const releases = [];
  let url = API_URL;
  let complete = true;
  for (let page = 0; page < MAX_RELEASE_PAGES; page += 1) {
    const result = await requestReleasePage(url, { request, timeoutMs, now });
    releases.push(...result.releases);
    if (!result.next) { url = null; break; }
    url = result.next;
    if (page === MAX_RELEASE_PAGES - 1) complete = false;
  }
  Object.defineProperty(releases, 'complete', { value: complete, enumerable: false });
  return releases;
}

module.exports = { OWNER, REPOSITORY, RELEASES_URL, API_URL, MAX_RELEASE_PAGES, normalizeVersion, findLatestStableRelease, expectedAssetNames, findLatestCompatibleRelease, requestReleases };
