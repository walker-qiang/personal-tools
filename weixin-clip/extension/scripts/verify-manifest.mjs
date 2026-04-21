#!/usr/bin/env node
/**
 * 本地自检：manifest JSON、关键字段、sw 中是否存在注入函数名。
 * 用法：node scripts/verify-manifest.mjs（在 extension/ 目录下执行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(__dirname, '..');
const manifestPath = path.join(extRoot, 'manifest.json');
const swPath = path.join(extRoot, 'sw.js');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) {
  throw new Error('expected MV3');
}
const perms = manifest.permissions || [];
if (!perms.includes('scripting')) {
  throw new Error('manifest.permissions must include "scripting"');
}
if (!perms.includes('contextMenus')) {
  throw new Error('manifest.permissions must include contextMenus');
}

const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('function injectedExtractPayload')) {
  throw new Error('sw.js must define injectedExtractPayload for executeScript');
}
if (!sw.includes('chrome.scripting.executeScript')) {
  throw new Error('sw.js must call chrome.scripting.executeScript');
}
if (!sw.includes('allFrames: true')) {
  throw new Error('sw.js must use allFrames: true');
}
if (sw.includes('getFileHandle') || sw.includes('clipArticle')) {
  throw new Error('sw.js must not perform File System writes (use writer.html + clip-core.js)');
}
const writerPath = path.join(extRoot, 'writer.html');
const corePath = path.join(extRoot, 'clip-core.js');
if (!fs.existsSync(writerPath) || !fs.existsSync(corePath)) {
  throw new Error('writer.html and clip-core.js are required');
}

const core = fs.readFileSync(corePath, 'utf8');
const idb = fs.readFileSync(path.join(extRoot, 'idb-store.js'), 'utf8');
for (const needle of [
  'function clipArticle',
  'sanitizeFileBaseForMd',
  'clipImageMode',
  'function buildImageWriteContext',
  'markdownRelViaVault',
  'function getOrCreateNestedDir',
  'writeMarkdownFile',
  'normalizeClipMode',
  '"参考文档"',
]) {
  if (!core.includes(needle)) {
    throw new Error('clip-core.js missing: ' + needle);
  }
}
if (
  !idb.includes('getVaultDirHandle') ||
  !idb.includes('getImagesRootDirHandle') ||
  !idb.includes('clearImagesRootDirHandle')
) {
  throw new Error('idb-store.js must expose vault + images directory handles');
}
if (!sw.includes('pickAuthor')) {
  throw new Error('sw.js must extract author metadata');
}
if (!sw.includes('#activity-name') || !sw.includes('pickTitle')) {
  throw new Error('sw.js must pick article title from page (activity-name / pickTitle)');
}

const optsHtml = fs.readFileSync(path.join(extRoot, 'options.html'), 'utf8');
const optsJs = fs.readFileSync(path.join(extRoot, 'options.js'), 'utf8');
if (!optsHtml.includes('id="pickImages"') || !optsJs.includes('pickImages')) {
  throw new Error('options page must expose pickImages for image directory');
}
if (!optsHtml.includes('id="pickVault"') || !optsJs.includes('startIn: vault')) {
  throw new Error('options must support vault root + startIn: vault for decoupled images');
}
if (!optsJs.includes('startIn: article') || !optsJs.includes('clipImageRelPath')) {
  throw new Error('options.js must use startIn: article and persist clipImageRelPath');
}

const writerJs = fs.readFileSync(path.join(extRoot, 'writer.js'), 'utf8');
if (!writerJs.includes('clipImageMode') || !writerJs.includes('vaultDirHandle')) {
  throw new Error('writer.js must pass clipImageMode and vaultDirHandle');
}

console.log('verify-manifest: OK', { name: manifest.name, version: manifest.version });
