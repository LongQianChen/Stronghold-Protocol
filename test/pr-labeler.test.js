// Execute the workflow's actual script with API doubles; this is not a GitHub Actions integration test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/pr-labeler.yml', import.meta.url), 'utf8');
const blocks = [...workflow.matchAll(/^ {10}script: \|\n((?: {12}.*\n|\n)+)$/gm)];
assert.equal(blocks.length, 2, 'the workflow contains separate PR and issue scripts');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runners = blocks.map((block) => new AsyncFunction('github', 'context', 'core', block[1].replace(/^ {12}/gm, '')));
const repo = { owner: 'sganggs', repo: 'Stronghold-Protocol' };

function harness(title, { labels = [], action = 'opened', changes, eventTitle = title, labelError, addError, isIssue = false } = {}) {
  const calls = [];
  const messages = [];
  const pr = { title, labels: labels.map((name) => ({ name })) };
  const context = {
    repo,
    issue: { ...repo, number: 123 },
    payload: {
      action, changes,
      [isIssue ? 'issue' : 'pull_request']: {
        number: 123, title: eventTitle,
        head: { ref: 'fix/example', repo: { full_name: 'contributor/Stronghold-Protocol', fork: true } },
      },
    },
  };
  const github = { rest: {
    pulls: { get: async (params) => {
      assert.equal(isIssue, false, 'issues must not use the PR endpoint');
      assert.deepEqual(params, { ...repo, pull_number: 123 });
      calls.push(['get', params]);
      return { data: pr };
    } },
    issues: {
      get: async (params) => {
        assert.equal(isIssue, true, 'PRs must not use the issue endpoint');
        assert.deepEqual(params, { ...repo, issue_number: 123 });
        calls.push(['get', params]);
        return { data: pr };
      },
      getLabel: async (params) => {
        assert.deepEqual(params, { ...repo, name: params.name });
        calls.push(['getLabel', params]);
        if (labelError) throw labelError;
        return { data: { name: params.name } };
      },
      addLabels: async (params) => {
        assert.deepEqual(params, { ...repo, issue_number: 123, labels: params.labels });
        calls.push(['addLabels', params]);
        if (addError) throw addError;
        for (const name of params.labels) pr.labels.push({ name });
      },
    },
  } };
  return { calls, messages, pr, context, run: () => runners[isIssue ? 1 : 0](github, context, { info: (message) => messages.push(message) }) };
}

test('metadata events have separate minimal job permissions, pinned actions and no executable contributor input', () => {
  assert.match(workflow, /^on:\n {2}pull_request_target:\n {4}types: \[opened, edited, reopened\]\n {2}issues:\n {4}types: \[opened, edited, reopened\]\n\npermissions: \{\}\n\njobs:/m);
  for (const [job, event, permission] of [
    ['label', 'pull_request_target', 'pull-requests'], ['issue-label', 'issues', 'issues'],
  ]) {
    const block = workflow.match(new RegExp(`^ {2}${job}:\\n((?: {4}.*\\n|\\n)+)`, 'm'))?.[1];
    assert.ok(block, `${job} exists`);
    assert.match(block, new RegExp(`^ {4}if: github.event_name == '${event}'$`, 'm'));
    assert.match(block, new RegExp(`^ {4}permissions:\\n {6}${permission}: write\\n {4}steps:`, 'm'));
    assert.equal((block.match(/^ {6}- uses:/gm) || []).length, 1);
    assert.match(block, /uses: actions\/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8/);
  }
  assert.doesNotMatch(workflow, /actions\/checkout|^\s*run:|\$\{\{|secrets\./m);
});

for (const [title, expected] of [
  ['fix: repair', 'bug'], ['bug: repair', 'bug'], ['docs: update', 'documentation'],
  ['feat: add', 'enhancement'], ['feature: add', 'enhancement'],
  ['FIX(ui): repair', 'bug'], ['BuG(server)：修复', 'bug'], ['Docs(readme)：说明', 'documentation'],
  ['FEAT(ui): add', 'enhancement'], ['Feature(界面)：新增', 'enhancement'], ['  fix：修复  ', 'bug'],
  ['fix: " ; process.exit(1); // ${{ secrets.TOKEN }} $(echo unsafe)', 'bug'],
]) {
  test(`maps ${JSON.stringify(title)} to ${expected}`, async () => {
    const h = harness(title, { labels: ['help wanted'] });
    await h.run();
    assert.deepEqual(h.calls.map(([name]) => name), ['get', 'getLabel', 'addLabels']);
    assert.deepEqual(h.calls[2][1].labels, [expected]);
    assert.deepEqual(h.pr.labels.map(({ name }) => name), ['help wanted', expected]);
  });
}

for (const title of [
  'chore: maintain', 'refactor: cleanup', 'test: coverage', 'ci: improve', 'perf: speed', 'style: format',
  'bugfix: repair', 'fixes: repair', 'prefix fix: repair', 'fix repair', 'fix[]: repair',
  'fix(): repair', 'fix(ui)(server): repair', 'fix(ui: repair', 'fix(ui\nserver): repair', '',
]) {
  test(`ignores ${JSON.stringify(title)}`, async () => {
    const h = harness(title, { labels: ['help wanted'] });
    await h.run();
    assert.deepEqual(h.calls.map(([name]) => name), ['get']);
    assert.deepEqual(h.pr.labels, [{ name: 'help wanted' }]);
  });
}

test('repeated runs skip an existing label and preserve every previous label', async () => {
  const h = harness('fix: repair', { labels: ['help wanted', 'enhancement'] });
  await h.run();
  await h.run();
  assert.equal(h.calls.filter(([name]) => name === 'addLabels').length, 1);
  assert.deepEqual(h.pr.labels.map(({ name }) => name), ['help wanted', 'enhancement', 'bug']);
  const existing = harness('BUG：修复', { labels: ['BUG', 'documentation'] });
  await existing.run();
  assert.deepEqual(existing.calls.map(([name]) => name), ['get']);
});

test('title edits use current PR metadata and add the new type without removing the old type', async () => {
  const h = harness('docs(ui)：说明', {
    action: 'edited', changes: { title: { from: 'fix: repair' } }, eventTitle: 'fix: repair', labels: ['bug'],
  });
  await h.run();
  assert.deepEqual(h.pr.labels.map(({ name }) => name), ['bug', 'documentation']);
});

test('body or base edits do not make any API calls', async () => {
  for (const changes of [undefined, {}, { body: { from: 'old body' } }, { base: { ref: { from: 'old' } } }]) {
    const h = harness('fix: repair', { action: 'edited', changes });
    await h.run();
    assert.deepEqual(h.calls, []);
  }
});

test('opened and reopened fork events add labels in the base repository', async () => {
  for (const action of ['opened', 'reopened']) {
    const h = harness('feat: add', { action });
    await h.run();
    assert.deepEqual(h.calls.at(-1), ['addLabels', { ...repo, issue_number: 123, labels: ['enhancement'] }]);
  }
});

test('a missing repository label is skipped without creating or adding it', async () => {
  const h = harness('fix: repair', { labelError: Object.assign(new Error('Not Found'), { status: 404 }) });
  await h.run();
  assert.deepEqual(h.calls.map(([name]) => name), ['get', 'getLabel']);
  assert.deepEqual(h.pr.labels, []);
  assert.equal(h.messages.length, 1);
});

test('permission and API failures remain visible', async () => {
  for (const status of [403, 500]) {
    const error = Object.assign(new Error('API failure'), { status });
    await assert.rejects(harness('fix: repair', { labelError: error }).run(), error);
    await assert.rejects(harness('fix: repair', { addError: error }).run(), error);
  }
});

test('issues recognize template prefixes and the existing explicit title conventions', async () => {
  for (const [title, expected] of [
    ['[Bug]: repair', 'bug'], ['[Feature]: add', 'enhancement'], ['  [bUg]：修复  ', 'bug'],
    ['[FEATURE]：新增', 'enhancement'], ['fix: repair', 'bug'], ['bug(server)：修复', 'bug'],
    ['docs: update', 'documentation'], ['Docs(readme)：说明', 'documentation'],
    ['feat(ui): add', 'enhancement'], ['feature: add', 'enhancement'],
    ['[Bug]: " ; process.exit(1); // ${{ secrets.TOKEN }} $(echo unsafe)', 'bug'],
  ]) {
    const h = harness(title, { isIssue: true, labels: ['help wanted'] });
    await h.run();
    assert.deepEqual(h.calls.map(([name]) => name), ['get', 'getLabel', 'addLabels']);
    assert.deepEqual(h.pr.labels.map(({ name }) => name), ['help wanted', expected]);
  }
});

test('issues leave ambiguous titles and malformed prefixes unlabelled', async () => {
  for (const title of [
    '', 'bug', 'Error', 'a bug: repair', 'prefix [Bug]: repair', '[Bug] repair', '[Bugfix]: repair',
    '[Feature request]: add', '[Docs]: update', '[Bug](ui): repair', '[Bug: repair', 'bug]: repair',
    'fix repair', 'fix(): repair', 'fix(ui)(server): repair', 'fix(ui\nserver): repair', 'chore: maintain',
  ]) {
    const h = harness(title, { isIssue: true, labels: ['help wanted'] });
    h.context.payload.issue.body = '[Bug]: critical P0';
    h.pr.body = '[Bug]: critical P0';
    await h.run();
    assert.deepEqual(h.calls.map(([name]) => name), ['get'], title);
    assert.deepEqual(h.pr.labels, [{ name: 'help wanted' }]);
  }
});

test('issues preserve template and manual categories even when the title suggests another type', async () => {
  for (const label of ['bug', 'BUG', 'enhancement', 'ENHANCEMENT', 'documentation', 'Documentation']) {
    const h = harness('[Bug]: repair', { isIssue: true, labels: ['help wanted', label] });
    await h.run();
    assert.deepEqual(h.calls.map(([name]) => name), ['get']);
    assert.deepEqual(h.pr.labels.map(({ name }) => name), ['help wanted', label]);
  }
  const h = harness('[Feature]: add', { isIssue: true });
  await h.run();
  await h.run();
  assert.equal(h.calls.filter(([name]) => name === 'addLabels').length, 1);
  assert.deepEqual(h.pr.labels, [{ name: 'enhancement' }]);
});

test('issue title edits fetch current metadata and keep the fallback category on later edits', async () => {
  const h = harness('[Feature]: add', {
    isIssue: true, action: 'edited', changes: { title: { from: '[Bug]: repair' } }, eventTitle: '[Bug]: repair',
  });
  h.context.payload.issue.labels = [{ name: 'bug' }];
  await h.run();
  assert.deepEqual(h.pr.labels, [{ name: 'enhancement' }]);
  h.pr.title = 'docs: update';
  h.context.payload.issue.labels = [];
  await h.run();
  assert.equal(h.calls.filter(([name]) => name === 'addLabels').length, 1);
  assert.deepEqual(h.pr.labels, [{ name: 'enhancement' }]);
});

test('issue body edits make no API calls; opened and reopened events use the issue endpoint', async () => {
  for (const changes of [undefined, {}, { body: { from: 'old body' } }]) {
    const h = harness('[Bug]: repair', { isIssue: true, action: 'edited', changes });
    await h.run();
    assert.deepEqual(h.calls, []);
  }
  for (const action of ['opened', 'reopened']) {
    const h = harness('[Bug]: repair', { isIssue: true, action });
    await h.run();
    assert.deepEqual(h.calls.at(-1), ['addLabels', { ...repo, issue_number: 123, labels: ['bug'] }]);
  }
});

test('issues skip missing repository labels and surface permission or API failures', async () => {
  const h = harness('[Bug]: repair', {
    isIssue: true, labelError: Object.assign(new Error('Not Found'), { status: 404 }),
  });
  await h.run();
  assert.deepEqual(h.calls.map(([name]) => name), ['get', 'getLabel']);
  assert.deepEqual(h.pr.labels, []);
  assert.equal(h.messages.length, 1);
  for (const status of [403, 500]) {
    const error = Object.assign(new Error('API failure'), { status });
    await assert.rejects(harness('[Bug]: repair', { isIssue: true, labelError: error }).run(), error);
    await assert.rejects(harness('[Bug]: repair', { isIssue: true, addError: error }).run(), error);
  }
});
