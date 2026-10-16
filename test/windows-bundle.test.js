// test/windows-bundle.test.js — Windows 便携包脚本里那几处「写错就会毁掉一次打包」的纯函数。
//
// 打包本身要联网下载官方 Node、还要 `npm ci`，不适合放进单元测试；这里盯住这些：
//   * `--out` 指向仓库自己或它的上级时，`--force` 会 `rm -rf` 掉仓库 —— 必须直接拒绝；
//   * 路径比较要经得起大小写（Windows / macOS 默认不区分）、符号链接、8.3 短名；
//   * `--force` 只肯删「空目录」或「上一次打的便携包」，认不出来就不许动；
//   * 素材是整树复制的，点开头的条目（打包机器的 .DS_Store）与符号链接不该跟着进包；
//   * 按清单复制时，缺失的源文件跳过而不是抛错（素材可能还没下载）；
//   * 包内说明的措辞：不能声称「不访问外网」（Google Fonts 外链没改），`--no-node` 时也不能说不用装 Node。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('make-windows-bundle.mjs: --out 不能指向仓库自己或它的上级', () => {
  test('仓库本身与它的上级目录都要拒绝', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(outDirIsUnsafe(ROOT), true, '仓库本身');
    assert.equal(outDirIsUnsafe(path.dirname(ROOT)), true, '仓库的上一级');
    assert.equal(outDirIsUnsafe(path.resolve(path.dirname(ROOT), '..')), true, '再上一级');
    assert.equal(outDirIsUnsafe(path.join(ROOT, '..', path.basename(ROOT))), true, '写成 .. 绕一圈也还是仓库自己');
  });

  test('仓库之外的目录放行（默认产物就是仓库的兄弟目录）', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(outDirIsUnsafe(path.join(path.dirname(ROOT), 'Stronghold-Protocol-Windows')), false, '默认产物位置');
    assert.equal(outDirIsUnsafe(path.join(os.tmpdir(), 'sp-bundle-out')), false, '临时目录');
    // 指向仓库**内部**是允许的：只是产物会出现在 git status 里，不会删掉仓库。
    assert.equal(outDirIsUnsafe(path.join(ROOT, 'dist-win')), false, '仓库内的子目录');
  });

  test('大小写不同也算同一个目录（Windows / macOS 的文件系统默认不区分大小写）', async (t) => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-case-'));
    t.after(() => fsp.rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'Stronghold-Protocol');
    await fsp.mkdir(root);
    // Linux 的默认文件系统区分大小写：`/HOME/X` 就是另一个目录，放行才对。
    const sameThing = process.platform !== 'linux';
    assert.equal(outDirIsUnsafe(root, root), true, '原路径');
    assert.equal(outDirIsUnsafe(path.join(base, 'STRONGHOLD-PROTOCOL'), root), sameThing, '全大写写法');
    assert.equal(outDirIsUnsafe(path.join(base, 'stronghold-protocol'), root), sameThing, '全小写写法');
  });

  test('经过符号链接的路径会被认出来（macOS 的 /tmp 就是指向 /private/tmp 的链接）', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-link-'));
    try {
      const real = path.join(base, 'real', 'Stronghold-Protocol');
      await fsp.mkdir(real, { recursive: true });
      const link = path.join(base, 'link');
      try {
        // Windows 上目录符号链接要管理员权限，junction 不用；其它平台用 dir。
        await fsp.symlink(path.join(base, 'real'), link, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;   // 建不出链接的环境（缺权限 / 缺支持）就跳过这一条
      }
      assert.equal(outDirIsUnsafe(path.join(link, 'Stronghold-Protocol'), real), true,
        '同一个目录，一条路径经过符号链接也要认出来');
      assert.equal(outDirIsUnsafe(path.join(link, 'Stronghold-Protocol', 'dist'), real), false, '仓库内部仍然放行');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: --force 只肯删空目录或上一次的包', () => {
  test('不存在 / 空目录 / 上一次打的包 → 可以删', async () => {
    const { forceDeleteVerdict } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-force-'));
    try {
      assert.equal(forceDeleteVerdict(path.join(base, 'nope')), 'missing');

      const empty = path.join(base, 'empty');
      await fsp.mkdir(empty);
      assert.equal(forceDeleteVerdict(empty), 'empty');

      const bundle = path.join(base, 'bundle');
      await fsp.mkdir(path.join(bundle, 'app'), { recursive: true });
      await fsp.writeFile(path.join(bundle, 'README-开箱即用.md'), '# x');
      await fsp.writeFile(path.join(bundle, 'LICENSE'), 'x');
      assert.equal(forceDeleteVerdict(bundle), 'bundle');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('有东西但不是上次的包 → 一律拒绝（包括桌面、仓库、只有半份的产物）', async () => {
    const { forceDeleteVerdict } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-force2-'));
    try {
      const desktop = path.join(base, 'Desktop');
      await fsp.mkdir(desktop);
      await fsp.writeFile(path.join(desktop, '重要文件.txt'), 'x');
      assert.equal(forceDeleteVerdict(desktop), 'refuse', '别人的目录不能删');

      assert.equal(forceDeleteVerdict(ROOT), 'refuse', '仓库根不是便携包');
      assert.equal(forceDeleteVerdict(path.dirname(ROOT)), 'refuse', '仓库的上级也不是');

      const half = path.join(base, 'half');
      await fsp.mkdir(path.join(half, 'app'), { recursive: true });
      assert.equal(forceDeleteVerdict(half), 'refuse', '只有 app 没有说明：可能是别人的目录，不删');
      const half2 = path.join(base, 'half2');
      await fsp.mkdir(half2);
      await fsp.writeFile(path.join(half2, 'README-开箱即用.md'), '# x');
      assert.equal(forceDeleteVerdict(half2), 'refuse', '只有说明没有 app：同样不删');

      const file = path.join(base, 'afile');
      await fsp.writeFile(file, 'x');
      assert.equal(forceDeleteVerdict(file), 'refuse', '同名文件不是目录，不删');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: 包内说明的措辞', () => {
  test('不再声称「不访问外网」，改成联网 / 断网两种情况都讲清', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    const r = bundleReadme({ version: 'v22.23.3', withNode: true });
    assert.ok(!/不访问外网/.test(r), 'index.html 的 Google Fonts 外链没改，不能说这个包不访问外网');
    assert.match(r, /不联网也能玩/, '断网可用要写清楚');
    assert.match(r, /Google Fonts/, '联网时会去 Google Fonts 加载字体，要如实说明');
    assert.match(r, /断网/, '断网时的回退也要写');
    assert.match(r, /不需要安装 Node/);
    assert.match(r, /node\\node\.exe/);
  });

  test('每条授权要点都在（素材归原权利人 / 不适用 GPL / 不单独再分发 / 可要求删除 / 无担保）', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    for (const withNode of [true, false]) {
      const r = bundleReadme({ version: 'v22.23.3', withNode });
      assert.match(r, /版权归原权利人所有/, `withNode=${withNode}`);
      assert.match(r, /不适用.*GPL/, `withNode=${withNode}`);
      assert.match(r, /单独再分发/, `withNode=${withNode}`);
      assert.match(r, /立即删除/, `withNode=${withNode}`);
      assert.match(r, /不提供任何担保/, `withNode=${withNode}`);
      assert.match(r, /严禁任何形式的盈利/, `withNode=${withNode}`);
      assert.ok(!/本包按 GPL/.test(r), `withNode=${withNode}: 不能写「本包按 GPL-3.0-or-later 分发」`);
    }
  });

  test('--no-node 时不再写「不需要安装 Node」，目录结构也不列 node\\', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    const r = bundleReadme({ version: 'v22.23.3', withNode: false });
    assert.ok(!/不需要安装 Node/.test(r), '没带便携 Node 就不能说不用装');
    assert.match(r, /没有带便携版 Node/, '要明确告诉玩家自己去装 Node 22/24');
    assert.ok(!/node\\node\.exe/.test(r), '目录结构里不该出现 node.exe');
    assert.ok(!/LICENSE-node\.txt/.test(r), '也不该提 node\\LICENSE-node.txt');
  });
});

describe('make-windows-bundle.mjs: PowerShell 单引号转义', () => {
  test("路径里的 ' 要写成 ''（否则 Expand-Archive 那条命令会被截断）", async () => {
    const { psSingleQuote } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(psSingleQuote('C:\\tmp\\node.zip'), "'C:\\tmp\\node.zip'");
    assert.equal(psSingleQuote("C:\\it's here\\node.zip"), "'C:\\it''s here\\node.zip'");
    assert.equal(psSingleQuote("a'b'c"), "'a''b''c'");
  });
});

describe('make-windows-bundle.mjs: 素材整树复制', () => {
  test('copyDir 跳过点开头的条目（打包机器自己的 .DS_Store）与符号链接', async () => {
    const { copyDir } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-copydir-'));
    try {
      const src = path.join(base, 'src');
      const dst = path.join(base, 'dst');
      await fsp.mkdir(path.join(src, 'sub', '.hidden'), { recursive: true });
      await fsp.writeFile(path.join(src, 'a.png'), 'a');
      await fsp.writeFile(path.join(src, '.DS_Store'), 'junk');
      await fsp.writeFile(path.join(src, 'sub', 'b.png'), 'bb');
      await fsp.writeFile(path.join(src, 'sub', '.keep'), 'junk');
      await fsp.writeFile(path.join(src, 'sub', '.hidden', 'c.png'), 'ccc');

      const r = await copyDir(src, dst);
      assert.equal(r.files, 2, '只数 a.png 与 sub/b.png');
      assert.equal(fs.existsSync(path.join(dst, 'a.png')), true);
      assert.equal(fs.existsSync(path.join(dst, 'sub', 'b.png')), true);
      assert.equal(fs.existsSync(path.join(dst, '.DS_Store')), false, '.DS_Store 不进包');
      assert.equal(fs.existsSync(path.join(dst, 'sub', '.keep')), false);
      assert.equal(fs.existsSync(path.join(dst, 'sub', '.hidden')), false, '点开头的目录整棵跳过');

      // 符号链接：Windows 上建链接需要权限，建不出来就跳过这条（复制逻辑本身仍然跳过链接）。
      let linked = false;
      try {
        await fsp.symlink(path.join(src, 'a.png'), path.join(src, 'link.png'));
        linked = true;
      } catch { /* 没有权限就算了 */ }
      if (linked) {
        const dst2 = path.join(base, 'dst2');
        await copyDir(src, dst2);
        assert.equal(fs.existsSync(path.join(dst2, 'link.png')), false, '符号链接不复制（目标可能指向仓库外）');
      }
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('copyFiles 跳过不存在的文件，其余照常复制', async () => {
    const { copyFiles } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-copyfiles-'));
    try {
      const src = path.join(base, 'src');
      const dst = path.join(base, 'dst');
      await fsp.mkdir(path.join(src, 'data'), { recursive: true });
      await fsp.mkdir(path.join(src, 'server'), { recursive: true });
      await fsp.writeFile(path.join(src, 'server', 'index.js'), 'code');
      await fsp.writeFile(path.join(src, 'data', 'local-assets.json'), '{}');

      const r = await copyFiles(['server/index.js', 'data/local-assets.json', 'public/assets/missing.png'], dst, src);
      assert.equal(r.files, 2, '缺失的那个被跳过');
      assert.equal(fs.existsSync(path.join(dst, 'server', 'index.js')), true, '目录自动建出来');
      assert.equal(fs.existsSync(path.join(dst, 'data', 'local-assets.json')), true);
      assert.equal(fs.existsSync(path.join(dst, 'public')), false, '没有文件就不该建空目录');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});
