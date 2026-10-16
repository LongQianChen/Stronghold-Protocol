// server/studio/templates/readme.js — the README.md a new plugin folder starts with (server/studio/templates/index.js):
// what the plugin is and the next steps, in Chinese and English. A document of the author's folder, never served.
// (i18n-ignore-file: a document written into a plugin folder, bilingual by design, 中文 · English — docs/I18N.md)

const STEPS = {
  art: ['把图片拖到工作台里对应的格子上（头像、立绘 …）；或者把图片放进 art/ 文件夹，在 plugin.json 的 "assets" 里写上它的路径。', 'Drop pictures on their places in the studio (avatar, portrait …), or put them into art/ and name their paths in "assets" of plugin.json.'],
  spine: ['把用 Spine 3.8 导出的 .skel、.atlas 和贴图 .png 一起拖到「正面 / 背面」格子上，然后点「打包」——打包会读出模型的动画。', 'Drop the .skel, the .atlas and the .png pages exported with Spine 3.8 together on the front / back place, then press 打包 (pack): it reads the model\'s clips.'],
  voice: ['每一句语音一个格子：把 .mp3 或 .ogg 拖进去，就替换这一句（可以放多个，轮流播放）。', 'One place per line: drop an .mp3 or .ogg on it to replace that line (several play in turn).'],
  audio: ['把 .mp3 或 .ogg 拖到音乐或音效的格子上；音乐可以另放一段只播一次的前奏。', 'Drop an .mp3 or .ogg on the music or sound place; a track may have an intro played once before its loop.'],
  dsl: ['干员的战斗规格写在 operators/ 的 "kit": { "dsl": { … } } 里；备战效果写在 dsl/ 的文件里（清单的 "dsl"）。改完运行 check --strict。', 'A battle spec lives in operators/ as "kit": { "dsl": { … } }; a prep effect lives in a file under dsl/ (the manifest\'s "dsl"). Then run check --strict.'],
};

/**
 * The README of a new plugin.
 * @param {{ id: string, name: string, template: string, target?: { key: string, name: string } | null }} opts
 * @returns {string}
 */
export function readmeOf({ id, name, template, target = null }) {
  const [zh, en] = STEPS[template] || STEPS.art;
  const what = target ? `${target.name}（${target.key}）` : '';
  const content = template === 'dsl';
  return `# ${name} · plugins/${id}/

${content ? '数据插件：一个 DSL 干员，以及一份把第 1 回合收入写成 15 的备战规格。' : (what ? `外观插件，替换：${what}。` : '外观插件。')}

1. ${zh}
2. 在工作台的预览里和原版并排对比；改动几秒内就会出现在游戏里（你自己是房主的房间、或单人房间会自动重新应用）。
3. 点「打包」生成 plugin.lock.json 并下载 zip；命令行：\`node tools/plugin.mjs check ${id}\`、\`node tools/plugin.mjs pack ${id} --zip\`。

不要把官方游戏的文件放进插件；可以引用本安装已有的素材（{ "ref": "…" }）。
文件格式：docs/PLUGINS.md §9；新手指南：docs/PLUGIN-GUIDE.md。

---

${content ? 'A content plugin: one DSL operator, and a prep spec that sets round-1 income to 15.' : `A cosmetic plugin${target ? ` replacing ${target.key}` : ''}.`}

1. ${en}
2. Compare it with the original side by side in the studio's preview; a change shows in the game within seconds (a room you
   host, or a single-player room, applies it again by itself).
3. Press 打包 (pack) to write plugin.lock.json and download the zip; on the command line:
   \`node tools/plugin.mjs check ${id}\`, \`node tools/plugin.mjs pack ${id} --zip\`.

Never put files of the official game in a plugin; refer to the installation's art instead ({ "ref": "…" }).
The format: docs/PLUGINS.md §9; the beginner's guide (Chinese): docs/PLUGIN-GUIDE.md.
`;
}
