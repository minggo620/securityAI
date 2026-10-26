#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('/Users/daitongmin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const file = path.resolve(__dirname, '..', 'security-audit-skill-交互流程导图.html');
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.goto(pathToFileURL(file).href);
    assert.deepEqual(await page.evaluate(() => ({ ...window.auditMap.dataSummary(), dictionarySha256: undefined })), { steps: 38, tables: 79, categories: 162, dictionarySha256: undefined });
    const expectedStats=JSON.parse(require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'security-audit-field-stats.cjs')],{encoding:'utf8',maxBuffer:1024*1024}));
    assert.deepEqual(await page.evaluate(()=>JSON.parse(document.getElementById('map-data').textContent).fieldStats),expectedStats);
    await page.locator('[data-go="field-statistics"]').click();
    assert((await page.locator('#detail').textContent()).includes('416 项'));
    assert((await page.locator('#detail').textContent()).includes('严禁按裸名称去重'));
    await page.locator('#detail .subnode').filter({hasText:'E.5.3 Hunter 返回 JSON'}).click();
    assert((await page.locator('#detail').textContent()).includes('candidates[].proposed_verdict'));
    await page.locator('#detail .related button').filter({hasText:'hunter|confirmed|candidates[].proposed_verdict'}).click();
    const bindingText=await page.locator('#detail').textContent();
    assert(bindingText.includes('confirmed'));
    assert(bindingText.includes('candidates[].proposed_verdict'));
    assert(bindingText.includes('必填'));
    await page.locator('#detail > details').filter({has:page.locator('summary',{hasText:'原文依据'})}).locator('summary').first().click();
    assert((await page.locator('#detail').textContent()).includes('report-schema.json'));
    await page.evaluate(()=>window.auditMap.select('P2.2'));
    await page.locator('#detail').getByRole('button',{name:'agent_id',exact:true}).click();
    const collisionText=await page.locator('#detail').textContent();
    assert(collisionText.includes('4 个结构化上下文'));
    assert(collisionText.includes('8.1 检查对象'));
    assert(collisionText.includes('8.2 历史尝试'));
    assert(collisionText.includes('8.3 ID 与关联规则'));
    assert.equal(await page.locator('#flow button').count(), 7);
    await page.locator('#flow [data-node="stage-2"]').click();
    assert.equal(await page.locator('#detail .subnode').count(), 13);
    await page.locator('#detail .subnode[data-node="P2.4"]').click();
    assert.equal(await page.evaluate(() => window.auditMap.getState().selected), 'P2.4');
    await page.getByRole('button', { name: 'trace', exact: true }).click();
    assert(await page.locator('#detail .field-detail').count() > 0);
    await page.locator('#detail > details').filter({ has: page.locator('summary', { hasText: '原文依据' }) }).locator('summary').first().click();
    await page.locator('#detail .source-box > summary').filter({ hasText: 'HUNTING.md:37' }).click();
    assert((await page.locator('#detail .source-lines:visible').first().textContent()).includes('READ THE CODE AT DEPTH'));
    await page.locator('[data-profile="quick"]').click();
    await page.locator('#flow [data-node="stage-4"]').click();
    assert((await page.locator('#detail').textContent()).includes('quick：记录检查已在 P3 完成 → 报告'));
    assert(await page.locator('#flow [data-phase="5"]').evaluate(e => e.classList.contains('merged')));
    await page.locator('#search').fill('hypothesis_id');
    assert(await page.locator('#search-results .navbtn').count() > 0);
    await page.locator('#search-results .navbtn').filter({ hasText: /^hypothesis_id$/ }).click();
    assert((await page.locator('#detail').textContent()).includes('建议新增'));
    await page.locator('#search').fill('');
    await page.locator('[data-profile="standard"]').click();
    const stage = page.locator('.navstage[data-stage="2"]');
    await page.locator('#flow [data-node="stage-2"]').click();
    assert(await stage.evaluate(e => e.open));
    await stage.locator('summary > button').click();
    assert(!(await stage.evaluate(e => e.open)));
    await stage.locator('summary > button').click();
    assert(await stage.evaluate(e => e.open));
    const hierarchyChecks=[];
    for(const index of [1,2,3]) {
      const group=page.locator('#tree > .navgroup').nth(index);
      await group.locator(':scope > summary').click();
      const branch=group.locator('.navtable').first();
      await branch.locator(':scope > summary').click();
      const leaf=branch.locator('.navleaf').first();
      await leaf.click();
      assert.equal(await leaf.getAttribute('aria-current'),'true');
      assert.equal(await branch.locator(':scope > summary').getAttribute('aria-current'),'false');
      const levels=await group.evaluate(g=>{
        const a=g.querySelector(':scope > summary'),b=g.querySelector('.navtable > summary'),c=g.querySelector('.navtable .navleaf');
        return [a,b,c].map(e=>({left:e.getBoundingClientRect().left,size:parseFloat(getComputedStyle(e).fontSize),weight:parseFloat(getComputedStyle(e).fontWeight)}));
      });
      assert(levels[0].left<levels[1].left&&levels[1].left<levels[2].left);
      assert(levels[0].size>levels[1].size&&levels[1].size>levels[2].size);
      assert(levels[0].weight>levels[1].weight&&levels[1].weight>levels[2].weight);
      hierarchyChecks.push({group:index,indentation:true,typeHierarchy:true,selectionSeparateFromExpansion:true});
    }
    await page.screenshot({path:'/private/tmp/security-audit-map-hierarchy.png',animations:'disabled'});
    const nodeCount = await page.evaluate(() => { const ids = window.auditMap.nodeIds(); for (const id of ids) window.auditMap.select(id); return ids.length; });
    assert.deepEqual(errors, []);
    const layouts = [];
    for (const width of [1400, 1024, 768, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.auditMap.select('field-statistics'));
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      if(size.scroll > size.viewport + 1) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, cls: e.className, text: e.textContent.slice(0,90), right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })).filter(e => e.width && e.right > innerWidth + 1).slice(0,12)));
      assert(size.scroll <= size.viewport + 1, `Horizontal overflow at ${width}: ${JSON.stringify(size)}`);
      layouts.push({ width, noHorizontalOverflow: true });
    }
    for (const spec of [{ width: 1400, scheme: 'light', node: 'field-statistics', name: 'desktop' }, { width: 360, scheme: 'light', node: 'field-statistics', name: 'mobile' }, { width: 1400, scheme: 'dark', node: 'field-statistics', name: 'dark' }]) {
      const fresh = await browser.newPage({ viewport: { width: spec.width, height: 1000 }, colorScheme: spec.scheme });
      fresh.on('pageerror', e => errors.push(e.message));
      fresh.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await fresh.goto(pathToFileURL(file).href);
      await fresh.evaluate(id => window.auditMap.select(id), spec.node);
      await fresh.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(await fresh.locator('h1').count(), 1);
      await fresh.screenshot({ path: `/private/tmp/security-audit-map-${spec.name}.png`, animations: 'disabled' });
      if (spec.name === 'mobile') { await fresh.locator('#detail').scrollIntoViewIfNeeded(); await fresh.screenshot({ path: '/private/tmp/security-audit-map-mobile-detail.png', animations: 'disabled' }); }
      await fresh.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    const embedded = await page.evaluate(() => JSON.parse(document.getElementById('map-data').textContent));
    const dictionary = fs.readFileSync(path.resolve(__dirname, '..', embedded.dictionary), 'utf8');
    const digest = require('node:crypto').createHash('sha256').update(dictionary).digest('hex');
    assert.equal(digest, embedded.dictionarySha256);
    console.log(JSON.stringify({ passed: true, nodeCount, steps: embedded.steps.length, categories: 162, testedInteractions: ['stage/step', 'field drill-down', 'source excerpt', 'quick bypass', 'search', 'expand/collapse', 'three-level hierarchy', 'every node', 'light/dark'], hierarchyChecks, layouts, scriptErrors: errors, networkRequests: requests, snapshotMatchesDictionary: true }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
