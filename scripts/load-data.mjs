// 在 Node 里加载 app/data/*.js（浏览器全局脚本）并返回 KSS 对象
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'app', 'data');
export const FILES = ['week1-2', 'week3-4', 'week5-6', 'week7-8', 'week9-10', 'week11-12', 'week13-14', 'week15-16', 'week17-18', 'week19-20', 'units-extra-1', 'units-extra-2', 'order', 'scenes-1', 'scenes-2', 'scenes-3', 'scenes-4', 'scenes-5', 'scenes-6', 'scenes-7', 'phrasebank', 'phrasebank-2', 'phrasebank-3', 'phrasebank-4', 'shadowing', 'shadowing-2', 'shadowing-3', 'qa', 'qa-2', 'styles', 'replies', 'listening', 'pairs', 'pronunciation', 'pronunciation-2', 'ai-scenarios'];

export function loadKSS() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(DATA_DIR, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  return ctx.KSS;
}
