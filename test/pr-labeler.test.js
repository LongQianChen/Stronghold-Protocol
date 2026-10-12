// Execute the workflow's actual script with API doubles; this is not a GitHub Actions integration test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/pr-labeler.yml', import.meta.url), 'utf8');
const block = workflow.match(/^ {10}script: \|\n((?: {12}.*\n|\n)+)$/m);
assert.ok(block, 'the workflow contains one inline script');
const script = block[1].replace(/^ {12}/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', script);
const repo = { owner: 'sganggs', repo: 'Stronghold-Protocol' };

function harness(title, { labels = [], action = 'opened', changes, eventTitle = title, labelError, addError } = {}) {
  const calls = [];
  const messages = [];
  const pr = { title, labels: labels.map((name) => ({ name })) };
  const context = {
    repo,
    issue: { ...repo, number: 123 },
    payload: {
      action, changes,
      pull_request: {
        number: 123, title: eventTitle,
        head: { ref: 'fix/example', repo: { full_name: 'contributor/Stronghold-Protocol', fork: true } },
      },
    },
  };
  const github = { rest: {
    pulls: { get: async (params) => {
      assert.deepEqual(params, { ...repo, pull_number: 123 });
      calls.push(['get', params]);
      return { data: pr };
    } },
    issues: {
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
  return { calls, messages, pr, context, run: () => run(github, context, { info: (message) => messages.push(message) }) };
}

test('only PR metadata events, minimal permission, pinned action and no executable PR input', () => {
  assert.match(workflow, /^on:\n {2}pull_request_target:\n {4}types: \[opened, edited, reopened\]\n\npermissions:/m);
  assert.match(workflow, /^permissions:\n {2}pull-requests: write\n\njobs:/m);
  assert.equal((workflow.match(/^ {6}- uses:/gm) || []).length, 1);
  assert.match(workflow, /uses: actions\/github-script@[a-f0-9]{40} # v8/);
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
