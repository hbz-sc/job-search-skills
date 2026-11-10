import { test, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { visionStatus } from '../src/vision.js';
import path from 'node:path';
test('defaults to collection with no model or artificial quota', () => {
  const c = loadConfig({keywords:['AI 应用开发工程师']}, process.cwd());
  expect(c.mode).toBe('collect'); expect(c.city).toBe('深圳');
  expect(c.maxJobs).toBeUndefined(); expect(c.browserDir).toBe(path.resolve('private/browser'));
  expect(c.actionTimeoutMs).toBe(15000); expect(c.readRetries).toBe(2);
  expect(c.noProgressLimit).toBe(3); expect(c.consecutiveErrorLimit).toBe(3);
  expect(visionStatus({})).toBe('disabled');
});
test('rejects malformed scope and unsafe values', () => {
  for (const bad of [{keywords:[]}, {keywords:[' ']}, {keywords:['AI'],maxJobs:0}, {keywords:['AI'],mode:'auto'}, {keywords:['AI'],intervalMs:-1}])
    expect(() => loadConfig(bad, process.cwd())).toThrow();
});
test('vision is reserved and never needed by core', () => {
  expect(visionStatus({VISION_ENABLED:'true'})).toBe('not_configured');
  expect(visionStatus({VISION_ENABLED:'true',DASHSCOPE_API_KEY:'test'})).toBe('reserved');
});
