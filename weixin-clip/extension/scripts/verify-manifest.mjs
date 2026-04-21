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

console.log('verify-manifest: OK', { name: manifest.name, version: manifest.version });
