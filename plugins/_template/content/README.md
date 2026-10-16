# 数据插件模板

复制此目录到 `plugins/data-demo/`。清单中的文件夹 id 与记录命名空间对应（`data-demo` → `data_demo`）；改名时一起改记录 id。

`data/bond.json` 把助力的基础防御加成改为 30%。`operators/guard.json` 添加普通/精锐演示守卫，并加入自选池；复用角峰的官方 kit，数值由此文件提供。`operators/caster.json` 是一个 DSL 干员：被动攻击力 +50%（`kit.dsl`）。`dsl/income.json` 把第 1 回合收入写成 15。素材只引用本安装已有的角峰，无官方素材文件。

复制后的文件夹名必须是 `data-demo`（清单里的 id）。用 `node tools/plugin.mjs new dsl <id>` 生成的插件则由文件夹名决定 id，可以直接 `check --strict`。格式和错误见 `docs/PLUGINS.md` §10 和 `docs/PLUGIN-DSL.md`。
