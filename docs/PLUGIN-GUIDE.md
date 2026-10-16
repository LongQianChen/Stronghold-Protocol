# 插件新手指南：从换立绘到玩法插件

这份指南写给**不会写代码、也不想碰命令行**的玩家：用浏览器里的「插件工作台」，几分钟就能把某个干员的立绘换成你自己画的，
和原版并排预览，打包成 zip 发给朋友。后面还有新干员、DSL、试一场、脚本、安装和批量删除的步骤。会用命令行的朋友，第二部分有同样事情的命令行做法。格式的完整说明在
[PLUGINS.md](PLUGINS.md)（英文，§9 外观插件、§15 工作台与工具）；让 AI 帮你做插件，请它先读 `plugins/AGENTS.md`。

> 外观插件只改画面和声音（头像、立绘、模型、图标、语音、音效、音乐），**不改任何数值和对局**：开了外观插件的对局仍然是原版对局。
> **不要把官方游戏的文件放进插件**——用自己画的、自己录的，或者「借用」本安装已有的素材（见下文）。

## 你需要什么

- 一台正在运行游戏服务器的电脑（自己电脑上 `npm start`，或者双击发布包里的启动脚本）。
- 浏览器（Chrome、Edge、Firefox、Safari 都行）。
- 你自己的图片：立绘建议 PNG 或 WebP，约 1024 × 1024，人物居中靠上；头像 180 × 180。

插件放在服务器的 `plugins/` 文件夹里，一个插件一个文件夹，文件夹名就是插件的 **id**。

## 做法一：用插件工作台（不写代码）

### 1. 打开工作台

服务器启动后，窗口里会多一行 **`Studio:`**，后面是工作台的地址，形如 `http://localhost:3000/studio/#key=…`。
点开它（或复制到浏览器）。`#key=` 后面是**工作台钥匙**：新建、修改插件都要用它。浏览器会记住钥匙，以后直接打开
`http://localhost:3000/studio/` 就行。同一个局域网里的其他电脑：把地址里的 `localhost` 换成服务器的局域网地址（窗口里
`LAN:` 那一行）。如果打开的工作台顶部有一条「只能查看」的提示，说明这个浏览器还没有钥匙——把 `Studio:` 那一行的地址
粘贴进去点「使用」。钥匙也存在服务器的 `plugins/.studio-key` 文件里；删掉这个文件再重启服务器就会换一把新钥匙。

工作台**只对本机和局域网开放**：别人从公网访问只会看到「页面不存在」。如果你用 **TCP 方式的内网穿透**（frp 的 tcp
隧道、`ssh -R`、ngrok tcp 之类）把服务器开给公网，公网来的连接在服务器看来就像来自本机——这时别人没有钥匙，改不了你的
插件，但能看到工作台里的插件；不想被看到就用 `SP_STUDIO=off` 启动服务器（关掉工作台）。

（截图位置：工作台首页——左边是插件列表和「新建插件」按钮，右边是四步说明。生成方法见文末「截图从哪里来」，文件名 `studio-start.png`。）

### 2. 新建插件，选模板

点左上角的 **「新建插件」**，选模板 **「换头像 / 立绘 / 图标」**。其他外观模板分别是换 Spine 模型、换语音、换音乐 / 音效；玩法与界面模板见后面的章节。

（截图位置：新建插件的模板列表。`studio-templates.png`）

### 3. 按官方名字找到要换的干员

在搜索框里输入干员的**官方名字**，例如「德克萨斯」，点结果里带头像的那一项。不需要知道 `char_102_texas` 这种内部 id——
它只是小字显示在名字下面。敌人、召唤物、道具、盟约、策略和界面图也都能这样搜。

（截图位置：搜索「德克萨斯」的结果。`studio-picker.png`）

### 4. 起名字，创建

名字已经帮你填好（可以改）；**插件 id 会自动生成**一个合法而且没人用过的（2–32 个小写英文字母、数字或 `-`）。作者和许可证可以现在填，
也可以以后在「信息」里填。点 **「创建插件」**：服务器在 `plugins/<id>/` 里建好文件夹，写好 `plugin.json`（插件的清单）和一份说明。

### 5. 把立绘拖到格子上

插件页面左边是一个个**格子**：头像、精英二头像、立绘、精英二立绘。每个格子左边是原版，右边是你的插件。把你的立绘图片**拖到「立绘」格子上**
（或者点格子选文件）。工作台会把它放进插件文件夹里正确的位置（`art/char_102_texas/portrait.png`），同时更新清单。

右边是**实时预览**，用的是游戏自己的界面：商店和整备区里的卡片头像、点开干员时的详情卡（立绘就在这里），**原版和插件并排**。
换模型的模板还会显示游戏自己的战场画面，可以切换待机、移动、攻击、技能（S1–S3）、眩晕、倒下、部署每一个动作，正面和背面都能看。

（截图位置：拖入图片后的插件页——格子里是你的图，右边卡片头像和详情卡并排对比。`studio-preview.png`）

不想自己画？点格子下面的 **「用已有的素材」**，搜索另一个干员，就能借用他的立绘（不复制任何文件）。点 **「恢复原版」** 就清空这个格子。

### 6. 看提示，一键修复

如果哪里不对，格子下面会出现**白话提示**：出了什么问题、怎么改，下面折叠着英文原文。很多问题有 **「一键修复」** 按钮
（例如缺少权限、版本号写错、模型还没打包）。插件右上角的标签写着「已载入：可以在游戏里开启」就说明没问题了。

### 7. 填信息

在 **「信息」** 里填：名字、简介、版本（每次发布前调大，例如 1.0.1）、作者、**许可证**（别人能不能转发和修改你的作品，例如
`CC-BY-4.0` 表示署名即可转载）、**素材来源**（谁画的；用了别人的作品请写明出处）、主页，以及「谁能开启」（房主给整个房间开、玩家只给自己开）。

### 8. 打包并下载

点右上角 **「打包并下载」**：工作台生成 `plugin.lock.json`（每个文件的校验值，模型的动画数据），再检查一遍，然后下载
`<id>-<版本>.zip`。这个 zip 就是可以分享的插件。

（截图位置：打包完成的提示条。`studio-packed.png`）

### 9. 在游戏里开启

- **房主给整个房间开**：在房间顶部点「原版 / 插件 ×N」标签，打开插件面板，勾选你的插件。房间里所有人都会看到新立绘。
- **只给自己开**：设置 → 外观插件，打开开关（只影响你自己的浏览器）。

**热重载**：工作台打开期间，插件文件一改（工作台里拖了新图，或者你用画图软件直接保存到插件文件夹里），**几秒内游戏里就跟着变**——
仅含外观插件的房间里，如果你是房主（同一个浏览器里玩），或者房间里只有你一个人，会自动重新应用；其他房间提示房主「请点重新应用」。有玩法插件的房间始终由房主手动重新应用，对局中保持原来的内容。个人插件在下次重新获取插件列表后跟随。

## 做法二：用命令行

```bash
# 1. 从模板新建（目标按官方名字找）
node tools/plugin.mjs new art my-texas --target 德克萨斯 --name "我的德克萨斯" --author 你的名字

# 2. 把图片放进文件夹，在 plugins/my-texas/plugin.json 的 "assets" 里写上路径：
#    "assets": { "chars": { "char_102_texas": { "portrait": "art/char_102_texas/portrait.png" } } }

# 3. 检查：每个问题下面一行白话说明和改法（--lang en 是英文，--json 给编辑器和 AI 用）
node tools/plugin.mjs check my-texas

# 4. 打包：写 plugin.lock.json，再打成 zip（默认放在 plugins/_dist/my-texas-1.0.0.zip）
node tools/plugin.mjs pack my-texas --zip
```

`node tools/plugin.mjs new` 不带参数会列出所有模板。`plugin.json` 开头的 `"$schema": "../../schemas/plugin.schema.json"`
让 VS Code 这类编辑器自动补全字段、标出写错的地方。

## 其他模板的要点

- **换 Spine 模型**：用 Spine 3.8 导出**二进制** `.skel`（不是 `.json` 骨骼），把 `.skel`、`.atlas` 和贴图 `.png` **一起**拖到
  「正面模型 / 背面模型」格子上。动画（待机、攻击、技能、倒下……）在打包时从模型里自动读出，不用手写；模型换了以后再打包一次。
- **换语音**：每一句语音一个格子（行动出发、行动开始、选中干员、部署、作战中 1–4、结算……，中文和日文配音分开）；一个格子放几个文件，
  游戏会轮流播放。每个格子都能点 ▶ 和原版对比着听。
- **换音乐 / 音效**：音乐分「循环部分」和只播一次的「前奏」（点「放入前奏」）；音效是 `.mp3` 或 `.ogg`；也能换某个干员自己的攻击、受击、技能声音。
- 一个插件可以同时换好几样：插件页下面的 **「添加替换内容」**，再选一个模板和目标（例如同一个干员的头像、模型和语音放在一个插件里）。

## 分享和安装

- 把 zip 发给别人。对方把它**解压到服务器的 `plugins/` 文件夹**里（解压出来的文件夹名就是插件 id），不需要重启服务器，刷新页面就能在插件面板里看到。
- 工作台和打包工具**不会检查**插件里有没有官方游戏文件——这是作者自己的责任。请只分享你有权分享的东西，并在「信息」里写清楚许可证和素材来源。

## 做一个新干员

1. 打开带工作台钥匙的 `/studio/`，点「新建插件」→「新干员」。按官方名字选一个技能和属性的参考干员，例如德克萨斯。
2. 起插件名字，确认自动生成的 id，创建。向导会生成自己的 `char_x_…` id、普通卡 `_a` 和精锐卡 `_b`，不用手工配对。
3. 填干员名字、职业、分支、稀有度和商店阶级。展开「普通」「精锐」分别改生命、攻击、防御等属性。
4. 「技能来源」选「借用官方 kit」「JSON 技能规格」或「DSL 技能 / 天赋」。借官方 kit 时仍按官方名字选；官方 kit 修复后，这个插件也会跟随。
   JSON 规格只适合已经会写 JSON 的作者。DSL 可以直接用下拉框编辑。
5. 展开「借用本安装已有的素材」，按名字选模型和头像的来源。这里生成 `{ ref }`，不复制官方素材。
6. 点「保存修改」，查看校验结果，再到「试一场」比较。最后「打包并下载」。外部编辑器改过文件时，请先重新读取再保存，以免覆盖。

（截图位置：`test/e2e/out/studio-gameplay-operator.png`，展示普通/精锐属性、官方 kit 来源和借用素材。）

命令行也可以：`node tools/plugin.mjs new operator my-operator --target 德克萨斯`。进阶参数放进一个 JSON 文件，
使用 `--options 文件名`，与工作台向导的 `options` 字段相同。随后运行 `check my-operator --strict`、`pack my-operator --zip`。

## 写一段 DSL 天赋

1. 新建「DSL 技能 / 天赋」。默认是一个被动攻击力提升 50% 的术师，附第 1 回合收入为 15 的备战文件；也可从地灵、隐现、德克萨斯、风丸、老鲤五个例子中选起点。老鲤是备战效果，其他四个生成可上场的新干员。
2. 在「天赋」点「添加触发规则」，选择「部署时」。在「条件」里按需选触发概率、生命比例或盟约条件。
3. 点「添加动作」，选「增加属性」→「攻击力比例」，把取值选为数字并填 `0.5`。也可以选择技能黑板、天赋黑板、单位实时属性，
   或用加减乘除组合取值。目标可以选自身、当前目标、范围内友方/敌人等。
4. 右侧/下方会显示同一套 `validateDsl` 的白话检查结果。按提示修正，直到「DSL 校验通过」，再保存和试跑。
5. 备战规则用「备战效果」模板：回合开始、收入、购买等触发器，配资金、盟约层数或道具动作。

风丸例子没有「技能结束时收回替身」这个 DSL 动作，适合 20 秒以内对照；完整限制见 [PLUGIN-DSL.md](PLUGIN-DSL.md) §7。
工作台生成 `kit: { dsl: … }`（战斗）或清单 `dsl: ["dsl/meta.json"]`（备战）以及 `dsl` 权限。
保存会重新校验当前规格，规格被拒绝时不会写入文件。校验请求失败时会明确提示，可以重试。整体检查与试跑还会核对内容组合的权限、引用和数值上限。

（截图位置：新干员向导中选择 DSL，展开触发器、条件和动作；浏览器验收后可保存为 `test/e2e/out/studio-gameplay-dsl.png`。）

## 试一场

1. 在插件列表选一个插件，打开「试一场」。在向导里尚未保存的修改也会作为临时草稿试跑，磁盘文件不会因此改动。
2. 选择「单干员对木桩」「对一波敌人」或「两名干员对打（定点攻击试验）」。源代码安装还可以选择 golden 中的战斗场景。
   默认优先派插件新增的干员；也可另选官方干员、对手和波次。普通预设的时长为 1–120 秒。
3. 点「开始对照」。服务器先校验插件并构建内容组合，错误会直接说明原因，不执行坏插件。脚本插件仍遵守服主开关和锁文件哈希许可。
4. 查看原版/插件的伤害、时长、结果和差值；新干员用所借用的官方干员作原版参照，参照名字显示在表里。
   两边回放都使用游戏自己的战场渲染器，可以暂停、重播和改变速度；「事件摘要与伤害统计」显示真实模拟结果。
5. 调整数值后再试。木桩是不会移动和攻击的高生命测试目标；定点对打是通过引擎攻击接口做的试验，敌人专用技能不会把另一个干员当敌人，
   不能据此判断正式 PvP 平衡。备战经济效果需要放进实际房间验证，单场战斗不派发备战事件。

每次对照在独立子进程中完成，默认最多同时 2 次、每次最多 20 秒墙钟时间。超时、崩溃或回放太大都有白话提示。
浏览器只播放快照与事件，不执行插件战斗脚本。只有本机/局域网带工作台钥匙的请求能启动。

（截图位置：`test/e2e/out/studio-gameplay-trial.png`，并排比较表与两侧回放。）

其他玩法模板：「改数值」展示原版属性/黑板字段和上限（黑板同键原版最大值的 10 倍，至少 64，正数步长下限显示在字段旁，非法值不能保存）；「新模式」继承官方模式并改经济和时长；
「界面小组件」选插槽、改标题，保存后用真实 `pluginFrame` 宿主播放假数据；「脚本插件」生成 SDK 骨架及 `test/` 测试，浏览器带钥匙时可只读查看，试跑沿用服主选择的沙箱或受信任模式。
请用编辑器打开插件文件夹，运行 `node tools/plugin.mjs test <id>`。

房间的插件面板现在会按清单显示布尔/整数/小数/枚举设置。房主点「应用设置」后，所有玩家会重新加载同一个内容组合。
其他玩家只读；正在对局时不能改。修改自动依赖插件的设置会把该插件变为显式选择。内容文件变动时只提示房主重新应用，运行中的对局保持旧内容。

## 遇到问题：症状 → 原因 → 怎么改

下面这张表由报错目录自动生成（`node tools/plugin.mjs errors --write`），和工作台、命令行里看到的说明是同一份。

<!-- plugin-errors:start (generated by node tools/plugin.mjs errors --write) -->
| 症状 | 代码 | 原因 | 怎么改 |
|---|---|---|---|
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_CHANGED` | 插件文件已被其他编辑器修改 | 重新读取插件，再保存你的修改。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TRIAL_BUSY` | 试验台正在运行其他对战 | 等当前对战完成后再试。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TRIAL_TIMEOUT` | 这次对战超过了试验台的时间上限 | 缩短场景时长，减少单位或检查插件效果。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TRIAL_FAILED` | 试验台子进程未能完成对战 | 重新检查插件；如果仍失败，请查看服务器日志。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TRIAL_LIMIT` | 这次对战的回放超过了大小上限 | 缩短对战时长或减少单位和特效。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TRIAL_SCENARIO` | 这个试验场景不能运行 | 选择有效的干员、波次和 1–120 秒时长；界面插件用沙箱预览。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_CONSENT` | 还有玩家未同意运行受信任插件 | 每个在座玩家须亲自确认当前内容组合的风险提示。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_TRUST_PUBLIC` | 公网监听默认禁止受信任插件 | 改为监听本机或局域网；确认风险后可显式使用 trusted-force。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_TRUST_PIN` | 插件锁文件无效、文件已改变或受信任哈希不符 | 重新打包以校验文件；受信任模式还需审核并在 plugins/config.json 的 trusted 中钉住锁文件 SHA-256。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_SCRIPTS_DISABLED` | 服主没有启用脚本插件 | 脚本隔离执行可设置 SP_PLUGIN_SCRIPTS=sandbox；受信任代码需设置 trusted 并审核、钉住 lock 哈希。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_SCRIPT_CHECK` | 脚本未通过兼容性检查：{detail} | 入口只导入 sp:sdk@1；导出同步 setup(sp)，使用 SDK 和确定性助手。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_SCRIPT_OVERRIDE` | 插件未声明要替换的官方技能 | 在清单 overrides 中列出要替换的官方 kit id。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_SCRIPT_CONFLICT` | 两个插件注册了同一个效果 | 关闭其中一个插件，或让作者改用不同的 id。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_WORKER_TIMEOUT` | 插件模拟长时间无响应 | 检查插件循环并降低每批模拟的负载 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_WORKER_FAILED` | 插件模拟进程出错 | 查看日志并修复插件 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_WORKER_STOPPED` | 插件模拟已停止 | 重新开始本场模拟 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_UNAVAILABLE` | 脚本沙箱未就绪 | 安装依赖并检查 SDK 接口 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_DISABLED` | 服务器未开启脚本沙箱 | 由服主设置 SP_PLUGIN_SCRIPTS=sandbox |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_CLASS` | 此插件类别不能进入脚本沙箱 | 仅将 script 类插件交给沙箱 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_HASH` | 脚本文件与内容哈希不符 | 重新应用插件并校验文件 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_IMPORT` | 脚本导入超出沙箱范围 | 只导入 sp:sdk@1 和插件内相对路径，避免循环导入 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_SYNTAX` | 脚本使用了不支持的模块语法 | 使用同步 setup 和静态导入，参见脚本文档 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_LIMIT` | 脚本文件超过沙箱上限 | 缩减文件数量和代码体积 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SANDBOX_MATH` | 脚本数学运算超出确定性范围 | 只用有限数字，幂指数必须是整数 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_UNKNOWN` | 本服务器没有安装这个插件 | 把插件文件夹放进服务器的 plugins/ 文件夹（文件夹名就是插件 id）；它不在了的话，在插件面板里把它关掉。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_BLOCKED` | 这个插件不能在这里启用：这个版本不应用它的类别，或者它的作用范围不包括这里 | 外观插件的 class 写 "cosmetic"；scope 写 ["room"]（房主给整个房间开）或 ["personal"]（玩家只给自己开），两样都要就都写上。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_DEPENDENCY` | 缺少这个插件需要的其他插件（或者版本不对），或者几个插件的加载顺序互相指向、成了一个圈 | 安装 requires 里写的插件（版本要在写的范围内）；或者删掉 loadAfter / loadBefore 里互相指向的那几条。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_CONFLICT` | 选中的插件互相冲突，不能一起用 | 关掉其中一个；插件的 conflicts 写着它和谁不能一起用。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_LIMIT` | 超出了本服务器的上限：{detail} | 少开几个插件，或者让插件小一点（压缩图片和声音、删掉没用到的文件、少用整条引用）。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_INCOMPATIBLE` | 这个玩法插件不适配本服务器的游戏版本（或插件接口版本） | 换一个适配本版本的插件版本（清单的 "app" 写着它适配的游戏版本），或者请作者更新。 |
| 房间里开不了这个插件，面板弹出提示 | `PLUGIN_BUSY` | 本服务器同时运行的插件组合已达上限 | 稍后再试，或者和正在用插件的房间选同样的插件；服主可以在 plugins/config.json 里调高 maxSets。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_NO_MANIFEST` | 插件文件夹里没有 plugin.json | 每个插件文件夹都要有一个 plugin.json（插件的清单）。在工作台点「新建插件」，或运行 node tools/plugin.mjs new，就会生成一个。旧式的 pack.json 是 packs/ 文件夹里的语言包用的。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_JSON` | {where} 读不出来：它不是有效的 JSON，或者太大 | 检查有没有多写或少写逗号、引号、括号（最后一项后面不能有逗号）；单个 JSON 文件不能超过 8 MB。用工作台编辑可以避免手写出错。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_JSON_LIMIT` | {where} 超出了 JSON 的限制（嵌套太深，或数字太大） | 嵌套不要超过 64 层，数字要是正常的有限数字，绝对值不超过 10 亿。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_MANIFEST_SHAPE` | plugin.json 的最外层不是 { … } 对象 | 整个文件要用一对大括号 { } 包起来，里面写 "名字": 值。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_MANIFEST_VERSION` | 缺少 "manifest": 2，或者写成了别的数 | 在 plugin.json 里写上 "manifest": 2（这是清单格式的版本，现在只能是 2）。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ID` | 文件夹名「{id}」不能当插件 id | 插件 id 就是文件夹名：2–32 个小写英文字母、数字或 -，不能以 - 开头（例如 texas-red）。把文件夹改个名就行。 |
| 插件能用，但检查时有提示 | `PLUGIN_ID_MISMATCH` | 清单里写的 "id" 和文件夹名「{id}」不一样，以文件夹名为准 | 删掉清单里的 "id"（文件夹名就是 id），或者把它改得和文件夹名一样。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_FIELD_UNKNOWN` | 「{where}」不是清单里的字段，被忽略了 | 检查拼写（大小写也要一样），或者删掉它。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CLASS` | 没有写插件类别 "class"，或者写了不认识的类别 | 外观插件写 "class": "cosmetic"。可选的类别：lang（语言）、cosmetic（外观）、content（数据）、script、ui、trusted。 |
| 插件能用，但检查时有提示 | `PLUGIN_TEXT` | 「{where}」应该是一段文字，或者 { "语言": "文字" }，被忽略了 | 写成 "名字"，或者 { "zh": "名字", "en": "Name" }。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_LANG_CODE` | 「{where}」不是语言代码 | 用 zh、en、ja、ko、zh-TW 这样的语言代码。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_VERSION` | 插件的版本号 "version" 没写，或者写法不对 | 写成三段数字，例如 "1.0.0"；以后每次改了插件都把它调大一点（1.0.1、1.1.0 …）。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_APP` | 适配的游戏版本 "app" 没写，或者写法不对 | 写成一个版本范围，例如 ">=0.3.0 <0.4.0"（本游戏现在是 {app}）。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_APP_MISMATCH` | 这个插件是给游戏 {range} 做的，本服务器是 {app} | 外观插件照样能用（只是提醒）。在新版本里确认没问题后，把 "app" 改成包含 {app} 的范围。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_API` | 插件接口级别 "api" 没写、不是整数，或者本游戏不支持 | 写 "api": {current}（本游戏支持 {min}–{current}）。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SCOPE` | 作用范围 "scope" 写得不对 | 外观插件写 ["room", "personal"]：room 是房主给整个房间开，personal 是玩家在设置里只给自己开。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_HOMEPAGE` | 主页 "homepage" 不是 http(s) 网址，被忽略了 | 写完整的网址，例如 https://example.com/my-plugin，或者删掉它。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DEPS` | 依赖关系（requires / optional / conflicts）写得不对：{where} | 写成 { "其他插件的 id": "版本范围" }，例如 { "base-skin": ">=1.0.0" }；不能写自己，同一个插件不能既需要又冲突，最多 32 个。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ORDER_HINTS` | 加载顺序（loadAfter / loadBefore / priority）写得不对：{where} | loadAfter 和 loadBefore 是插件 id 的列表（同一个 id 不能两边都写，也不能写自己）；priority 是 -1000 到 1000 的整数，默认 0。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SETTING` | 设置项 "settings" 写得不对：{where} | 每个设置项写 { "type": … }：boolean（开关）、integer / number（要写 min 和 max）、enum（要写 options 列表）；默认值要在范围内；最多 32 个，不能是自由文字。 |
| 插件能用，但检查时有提示 | `PLUGIN_SETTING_FIELD` | 设置项里有不认识的字段「{where}」，被忽略了 | 设置项只认 type、default、min、max、step、options、label 这几个字段。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PART_CLASS` | 「{where}」不是 {class} 插件能带的东西 | 外观插件只带 "assets"（素材）和 "theme"（主题）；界面插件带 "entry.client" 和 "slots"；改数值、加干员之类的要做成 content 插件。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PART_SHAPE` | 「{where}」的写法不对 | 写成插件文件夹里的一个 .json 文件路径（或这些路径的列表）；"assets" 和 "theme" 也可以直接写成 { … } 对象。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ASSET_FILE` | 素材「{where}」写的文件不对：不是插件文件夹里的路径，或者不是这个位置要的文件类型 | 写插件文件夹里的相对路径，例如 art/avatar.png。图片位置用 .png .jpg .webp，声音位置用 .mp3 .ogg，模型用 .skel 和 .atlas（贴图 .png）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_THEME_URL` | 主题 "theme" 里写了网址 | 主题只能写颜色、长度和插件自带的字体名，不能引用网址（这是为了防止泄露数据）。 |
| 插件能用，但检查时有提示 | `PLUGIN_THEME_UNUSED` | 这个版本还不应用 "theme"（只应用 "assets" 里的素材） | 可以先留着，以后的版本会用上；或者删掉它，提示就没了。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ENTRY` | 入口 "entry" 写得不对，或者这个类别不能有入口：{where} | 外观插件不需要 "entry"，删掉它。界面插件写 "entry": { "client": "ui/index.html" }（插件文件夹里的一个 .html 文件）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_LANG_ONLY` | 「{where}」只属于语言包（lang 类），{class} 插件不能写 | 删掉它；要做语言包的话，把 class 改成 "lang"。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PERMISSION` | 权限写得不对：「{where}」不认识，或者 {class} 插件不能有 | 外观插件能用的权限：assets.override（替换本安装已有的素材）、assets.add（新增一个本安装没有的条目）、theme；界面插件用 ui.frame。"permissions" 要写成列表。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PERMISSION_MISSING` | 「{where}」需要权限 {need}，清单里没有声明 | 在 "permissions" 里加上 "{need}"。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_PERMISSION_UNUSED` | 声明了权限 {permission}，但插件里没有用到它的东西 | 从 "permissions" 里删掉 "{permission}"（声明的权限越少，越容易让人放心）。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_EMPTY` | 这个插件什么都没带 | 外观插件要在 "assets" 里写要替换的素材。在工作台用模板开始最省事。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_LINK` | {where} 是符号链接（快捷方式），插件里只能放普通文件 | 把真正的文件复制进插件文件夹，再删掉这个链接。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_NAME` | 文件名「{where}」不能用 | 文件名和文件夹名只用英文字母、数字、. _ - 和空格；不要以 . 开头，也不要有 ".." 这样的部分。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_TYPE` | {where}：这种文件不能放进 {class} 插件 | 图片用 .png .jpg .webp（不收 SVG），声音用 .mp3 .ogg，模型用 .skel .atlas，说明文档 .md .txt 和 README / LICENSE 可以放。把这个文件移出插件文件夹（一键修复会把它移到 plugins/_moved/ 里，不会删掉），或转换成能用的格式。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_FRAME` | {where} 是界面文件，但不在 entry.client 所在的文件夹里 | 把界面插件的 .html .js .css 都放进 entry.client 那个文件夹。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_SIZE` | 插件太大了：{where} | 一个插件最多 200 MB、5000 个文件（文件夹最多 2000 个、12 层），单个 JSON 最多 8 MB。压缩图片和声音，删掉没用到的文件，或者拆成几个插件。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_MISSING` | 清单里写了 {file}，但插件文件夹里没有这个文件 | 把文件放到这个位置（注意文件夹和大小写都要一样），或者改正清单里的路径。在工作台把文件拖到对应的格子里就会放对。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FILE_OUTSIDE` | {where} 指到了插件文件夹外面，或者在插件文件夹里读不出来 | 插件只能用自己文件夹里的普通文件：把文件复制进来，别用链接，并检查文件能不能打开。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_LANG` | 语言包的语言写得不对：{where} | "lang" 写语言代码（en、ja、zh-TW …）；zh 是源语言，不能做成语言包；machineTranslated 写 true 或 false。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_LANG_FILES` | 语言包的文件表 "files" 写得不对：{where} | "files" 写 { "ui": "ui.json" }（必填）和可选的 { "data": "data.json" }，都是包里的 .json 文件。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PACK` | 旧式内容包（pack.json）写得不对，或者这个版本不加载它的类型：{where} | packs/ 里只加载语言包（"type": "lang"）。外观和数据请做成 plugins/ 里的插件（plugin.json，"manifest": 2）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ASSETS_SHAPE` | 素材表 "assets" 的写法不对：{where} | 按 data/assets.json 的样子写：chars → 干员 id → avatar / portrait / spine …，声音在 audio 里。用工作台的模板就不用手写。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_ASSET_KEY` | 「{where}」不是素材条目的名字 | 条目名是干员、敌人等的内部 id（例如 char_102_texas，只有字母、数字、_ . / -）。在工作台按官方名字搜索，就不用自己找 id。 |
| 插件能用，但检查时有提示 | `PLUGIN_ASSET_IGNORED` | 「{where}」不是外观插件能改的位置，被忽略了 | 检查拼写；外观插件能改的位置见 PLUGINS.md §9 的表（头像、立绘、模型、图标、界面图、语音、音效、音乐）。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_REF` | 引用「{where}」不对：写法不对，或者本安装没有它指向的素材 | { "ref": "char_112_siege" } 借用本安装已有的同类条目。在工作台点「用已有的素材」从列表里选，就不会写错；或者删掉这条。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SPINE` | Spine 模型「{where}」写得不对 | .skel 和 .atlas 放在同一个文件夹、用同一个名字（t.skel + t.atlas），贴图 .png 放在 atlas 旁边并写进 textures；动画数据不要手写，点「打包」自动生成。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SPINE_PAGES` | {file} 用到的贴图没有写进 "textures" | 把 atlas 里每一页贴图都写进 "textures"（一键修复会按 atlas 自动填好）。（工作台可一键修复） |
| 插件能用，但检查时有提示 | `PLUGIN_SPINE_NOTE` | 模型 {file} 有小问题：{detail} | 多半是 "textures" 写了 atlas 没用到的图片，或者有部件在 atlas 里找不到。模型通常还能显示，在预览里看一下。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SPINE_PARSE` | 模型 {file} 读不出来：不是游戏能读的 Spine 3.8 二进制骨骼，或者里面没有动画 | 用 Spine 3.8 导出二进制 .skel（不要 .json 骨骼），并确认导出时带了动画（Idle、Attack、Die …）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_LOCK` | plugin.lock.json 坏了，或者是旧格式 | 在工作台点「打包」，或运行 node tools/plugin.mjs pack，重新生成它；不要手改这个文件。（工作台可一键修复） |
| 插件没出现在列表里（被跳过），因为模型还没打包 | `PLUGIN_LOCK_MISSING` | 模型 {file} 还没有动画数据（plugin.lock.json 里没有它） | 点「打包」（或运行 node tools/plugin.mjs pack <插件>），它会读出模型的动画写进 plugin.lock.json。（工作台可一键修复） |
| 换了模型文件后插件消失了 | `PLUGIN_LOCK_STALE` | 模型 {file} 改过了，plugin.lock.json 里还是旧模型的数据 | 再点一次「打包」（或运行 node tools/plugin.mjs pack），锁文件就会跟上新模型。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DUPLICATE` | 插件 id 或语言重复了：{where} | 换一个文件夹名（插件 id；Windows 和 macOS 上大小写不同也算同一个），或者删掉重复的那个。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_UNREADABLE` | 读取插件时出错：{detail} | 检查文件的读取权限；如果有程序正在写这个文件夹，等它写完再试。 |
| 插件能用，但检查时有提示 | `PLUGIN_REQUIRES_MISSING` | 它需要的插件 {dep} 没有安装，或者版本不在 {range} 里 | 把需要的插件也装上（版本在范围内）；不然房主在房间里开它时会被拒绝。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_PATH` | 这个路径不能用：{detail} | 文件只能放在插件自己的文件夹里；路径不能有 ..、以 . 开头的部分或特殊字符，也不能经过链接跑到外面。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_SIZE` | 文件太大了（上限 {max}） | 把图片或声音压缩一下再拖进来（立绘用 1024 像素以内的 PNG/WebP 就够了）。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_EXISTS` | 已经有一个叫「{id}」的插件了 | 换一个 id，或者在列表里打开那个插件接着改。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TEMPLATE` | 不认识这个模板：{template} | 从工作台的模板列表里选一个（node tools/plugin.mjs new 不带参数会列出全部模板）。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_TARGET` | 找不到要替换的目标「{target}」 | 用搜索框按官方名字找（例如「德克萨斯」），从结果里点一个。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_FILE_KIND` | 这个位置要放 {kind}，拖进来的文件是 {ext} | 图片位置放 .png .jpg .webp，声音位置放 .mp3 .ogg，模型位置一次放 .skel、.atlas 和它的 .png。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_STUDIO_REQUEST` | 工作台的请求不对：{detail} | 刷新工作台页面再试；还不行的话，到 GitHub 提问并附上这段文字。 |
| 工作台只能查看，不能新建或修改插件 | `PLUGIN_STUDIO_KEY` | 改动插件需要工作台钥匙，这个浏览器还没有（或者钥匙不对） | 打开服务器窗口里「Studio」那一行的地址（它带着钥匙，钥匙也在 plugins/.studio-key 文件里），或把它粘贴到工作台顶部的输入框。 |
| 「删除所选」留下了某个插件：它正在使用 | `PLUGIN_STUDIO_IN_USE` | 插件「{id}」正在使用中（房间 {rooms}），没有删除 | 等这些房间解散，或者房主在房间的插件面板里关掉它（正在对局的房间要等这一局结束才能改）后再删除。 |
| 「删除所选」没能移走某个插件 | `PLUGIN_STUDIO_REMOVE` | 插件「{id}」没能移到 plugins/_removed/：{detail} | 关掉正在使用这个插件里文件的程序（图片编辑器、Spine 等），确认服务器能写 plugins/ 文件夹后再试；也可以自己把这个文件夹移出 plugins/。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CONTENT_FILE` | 数据文件「{where}」读不了：{detail} | "data" 里写插件文件夹里的 .json 文件路径；不要用符号链接，也不要指到文件夹外面。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CONTENT_FORMAT` | 数据文件「{where}」的格式不对：{detail} | 补丁文件写 { "patch": 1, "ops": [ … ] }，记录文件写 { "records": 1, "entries": [ … ] }；plugins/_template/content/ 里各有一个例子。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CONTENT_PERMISSION` | 数据文件「{where}」要用的权限没有声明：{detail} | 改已有的数值要 "data.patch"，新增记录（新干员、新敌人等）要 "data.add"，写进 "permissions"。（工作台可一键修复） |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_LIMIT` | 数据太大或者嵌套太深（{where}）：{detail} | 一个 JSON 文件不超过 8 MB、嵌套不超过 64 层，整套内容不超过 300 MB；把大文件拆开，删掉没用的部分。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_NUMBER` | 数字不合规（{where}）：要是有限的数，绝对值不超过 10 亿 | 把这个数字改小；数据里不能写无穷大或者特别大的数。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_TYPE` | 「{where}」不是普通的 JSON 值：{detail} | 只写 JSON 支持的值：对象、列表、字符串、数字、true / false、null。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_PATH` | 「{where}」用了不允许的键名 | __proto__、prototype、constructor 这类键名不能用（它们能改坏程序里的对象），换一个名字。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_BOUND` | 数值超出了插件允许的范围（{where}）：{detail} | 每个数值最多是原版同一个键最大值的 10 倍（至少允许到 64）；间隔、周期、费用这类步长不能小于原版最小值的十分之一。把数字改小一点——原版 3 倍以内的创意数值都能用。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_REQUIRED` | 合并后的数据缺东西或者写坏了（{where}）：{detail} | 补丁不要删掉游戏必需的字段或者整张表；按后面的英文原文找到是哪一处。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_REFERENCE` | 「{where}」引用了不存在的东西：{detail} | 检查拼写：引用的盟约、敌人、干员、效果等 id 要在原版或这个插件里存在（大小写一致）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DATA_PAIR` | 干员棋子的普通卡和精英卡对不上（{where}） | 新干员要成对：…_a 是普通卡、…_b 是精英卡（isGolden: true），两张的 charId 和 tier 一样；用紧凑记录（records 文件）写，工具会替你生成这一对。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PATCH_OP` | 不认识的补丁操作（{where}） | "op" 只能是 set、merge、add、append、remove 之一。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PATCH_PATH` | 补丁的位置写错了（{where}）：{detail} | "file" 写数据表名（chess、bonds、enemies…），"id" 写记录 id，"path" 是键名或数组下标组成的列表，例如 ["bb", "atk"]。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PATCH_TYPE` | 补丁的值类型不对（{where}）：{detail} | "set" 要保持原来的类型（数字还是数字，列表还是列表）；新记录必须是对象；"ops" 是列表。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_PATCH_SETTING` | 补丁用到的设置项不存在（{where}） | { "$setting": "名字" } 里的名字要在清单的 "settings" 里声明。 |
| 插件能用，但检查时有提示 | `PLUGIN_PATCH_OVERRIDE` | 两个插件改了同一个数值（{where}），后加载的那个生效 | 一般不用管；想让某个插件的值生效，用 loadAfter / loadBefore 调整加载顺序，或者只开其中一个。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_RECORD_EXISTS` | 要新增的记录已经存在（{where}） | 改已有的记录用补丁（patch 文件里的 set / merge）；新增的记录要起一个新的 id。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_RECORD_DELETE` | 插件不能删除记录（{where}） | 想让一个干员或敌人不出现，就改它在卡池、关卡或波次里的数据，不要删记录本身。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_RECORD_ID` | 新记录的 id 不在这个插件的命名空间里（{where}）：{detail} | 新记录的 id 要带上插件 id：插件 my-mod 的新干员写 char_x_my_mod_名字（插件 id 里的 - 换成 _），技能写 skx_my_mod_…；用 kitRef 借官方技能时可以保留官方技能 id。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_RECORD_TYPE` | 紧凑记录的写法不对（{where}）：{detail} | 干员要写 charId、名字、职业、位置、稀有度（1–6）；kit 只能选一种来源：generic、ref（借官方 kit）、dsl 或一份 JSON 技能规格。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_RECORD_SKILLS` | 干员的技能列表不对（{where}）：{detail} | 技能列表里正好有一个默认技能（default: true），而且它和 "skill" 写的是同一个；改技能说明里的次数时，两处一起改。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_KIT_REF` | "kitRef" 写的官方 kit 不存在（{where}） | kitRef 写官方干员的 id（例如 char_102_texas），它的技能逻辑会照搬过来；拼写要和官方一致。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_SKILL_SPEC` | JSON 技能规格写得不对（{where}）：{detail} | 按 docs/PLUGINS.md §10 的 SkillSpec 写：kind 和 mods 里的已知字段；talentMods 只能和 JSON 技能规格一起用，不能和 kit.ref 一起。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_EFFECT_REF` | 效果引用不对（{where}）：{detail} | effectRef 要指向一个官方的道具或策略记录；驻守效果和 buff 的键要用游戏里已有的。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_I18N` | 插件的翻译文件不对（{where}）：{detail} | 翻译文件写 { "version": 1, "lang": "en", "files": { … } }，lang 和文件名一致；只能替换已有的文字，不能新增字段。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_UI_SLOTS` | 界面插件的 "slots" 写得不对：{detail} | "slots" 是列表，从 hud.right、result.tab、stats.tab、room.panel 里选，每个最多写一次。 |
| 插件能用，但检查时有提示 | `PLUGIN_UI_NO_SLOT` | 界面插件没有要任何位置，页面不会显示出来 | 在 "slots" 里写上它要放的位置，例如 ["hud.right"]。 |
| 界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息） | `PLUGIN_SLOT` | 界面插件要的位置没有给它：清单的 "slots" 里没有这个位置，或者别的插件已经占了 | 在 plugin.json 的 "slots" 里写上这个位置（hud.right、result.tab、stats.tab、room.panel）。一个位置只放一个插件，先开的先得。 |
| 界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息） | `PLUGIN_RATE` | 界面插件发消息太快，被限流了 | 每个插件每秒最多 20 条（连发最多 40 条）。把要发的东西攒一攒再发，或者只在数据变了的时候发。 |
| 界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息） | `PLUGIN_STORAGE` | 界面插件的存储请求被拒绝：键名不合规，或者超出了容量 | 键名 1–64 个字符，只用字母、数字和 . _ -；一个值的 JSON 不超过 4096 字节；每个插件最多 32 个键、一共 32 KB。 |
| 界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息） | `PLUGIN_INTENT` | 界面插件想发对局操作，被拒绝了 | 界面插件只能看，不能操作对局（它不能成为自动操作或作弊工具）：不要发 hello、ping、room.*、g.*、b.* 这类消息，也不要把它们夹在别的消息里。 |
| 界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息） | `PLUGIN_SHAPE` | 界面插件发来的消息格式不对，被丢弃了 | 每条消息都是 { "v": 1, "t": 类型, … }，类型只能是 ready、slot、resize、storage、notice、stats，一条不超过 8 KB；格式见 schemas/ui.schema.json。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_SHAPE` | DSL 规格的整体写法不对：{detail} | 整份规格是一个对象：{ "dsl": 1, "pluginId": "插件 id", 然后是 "skill"、"skills"、"talents" 或 "meta" }。 |
| 插件没出现在列表里（被跳过）；check 指出 DSL 版本 | `PLUGIN_DSL_VERSION` | 这个版本只认 "dsl": 1 | 在规格最外层写 "dsl": 1。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_PLUGIN_ID` | DSL 规格写的插件 id 和装着它的插件对不上：{detail} | "pluginId" 写装着这份规格的插件自己的 id（插件文件夹名），或者不写，由服务器填上。一个插件不能用别的插件的动作预算。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_BUDGET` | 动作预算 "budget" 要是 1 到 10000000 的整数 | 写一个整数，或者删掉 "budget" 用默认的 8000。一场战斗里这个插件的动作执行次数超过预算，它的效果就在这一场里停下。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_LOOP` | DSL 里写了循环或外部代码，或者嵌套太深：{detail} | DSL 不支持循环和代码（loop、while、script 之类的字段）；"then" 最多嵌套 4 层，一个取值最多 64 层、64 个节点。复杂的逻辑做成脚本插件。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_TRIGGER` | 不认识的触发器（{where}）：{detail} | 战斗里用 always、deploy、battleStart、attack、hitDealt、hitTaken、kill、allyDeath、skillStart、skillEnd、every、hpBelow；备战用 roundStart、income、buy、sell、refresh、merge、levelUp、battleResult。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_CONDITION` | 条件写得不对（{where}）：{detail} | 条件写成 { "条件名": 值 }，条件名用 chance、targetHas、selfHpBelow、enemiesInRange、bondActive、skillActive；备战只能用 round、chance、bondActive。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_ACTION` | 动作写得不对（{where}）：{detail} | "do" 是动作的列表，每个动作是 buff、status、damage、heal、sp、dp、push、pull、spawnToken、layers、shield、fx 之一（备战是 funds、layers、gainItem），各自的字段见 docs/PLUGIN-DSL.md §4。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_TARGET` | 目标写得不对（{where}）：{detail} | 目标用 self、target、source、alliesInRange、enemiesInRange、enemiesInRadius、lowestHpAlly、allAllies；spawnToken 的 "tile" 写 "around" 或 { "r": 行, "c": 列 }。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_EVERY` | "every" 的间隔太短（{where}）：{detail} | "seconds" 至少是一帧（1/30 秒）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_NUMBER` | 数值不在允许的范围里（{where}）：{detail} | 写有限的数：hpBelow 的阈值大于 0、不超过 1，"times" 是 1 到 8 的整数。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_DIV0` | 除数是 0（{where}） | "div" 的第二项不能是 0；要表示「不变」就乘以 1。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_VALUE` | 取值写得不对（{where}）：{detail} | 取值是数字、{ "bb": "键" }、{ "talent": [序号, "键"] }，或者用 mul、add、sub、div、min、max 组合起来；列表只能写在这些组合里。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_SKILL` | 技能规格写得不对（{where}）：{detail} | "skill" 是一个对象，"kind" 用 instant、duration、ammo、charges、toggle、passive；几个技能就写 "skills": { "技能 id": { … } }。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_META` | 备战规格写得不对（{where}）：{detail} | 写成 "meta": { "on": [ { "when": 触发器, "do": [ 动作 ] } ] }；"meta.key" 写成 effect:<插件 id>:<名字>，插件 id 是这个插件自己的。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_DSL_TALENT` | 天赋写得不对（{where}）：{detail} | "talents" 是列表，每一项是 { "when": 触发器, "if": 条件, "do": [ 动作 ] } 这样的对象。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CATALOG_SHAPE` | 目录文件的结构不对：{detail} | 目录是一个 JSON 对象，"catalog" 为 1，"name" 是名字，"plugins" 是插件列表。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CATALOG_URL` | 目录或插件地址不是可以下载的 https：{detail} | 地址以 https:// 开头，主机名要有点，不能写账号密码。下载时只访问公网地址的 443 端口；内网、本机、链路本地和 .local 会被拒绝，除非服主在 allowDownloadHosts 里点名。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CATALOG_HASH` | 目录条目缺少 sha256，或者不是 64 位小写十六进制：{detail} | 每个插件都写上它的 zip 的 SHA-256（64 位小写十六进制）。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CATALOG_ID` | 插件 id 不合法或重复：{detail} | id 是 2 到 32 位小写字母、数字和连字符，并且在这份目录里只出现一次。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_CATALOG_FIELD` | 目录字段不合法：{detail} | 按 docs/plugin-catalog.example.json 写：版本是 semver，class 是已知类别，过长的文字要缩短。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_CATALOG_SIZE` | 目录文件太大：{detail} | 目录本身不超过 1 MB。插件 zip 另有 200 MB 的上限。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_CATALOG_FETCH` | 读不到这份目录：{detail} | 确认地址是公网 https 的 443 端口、服务器能访问它，并且没有被重定向到内网或非 https。这一次等待包含正文，不是每一跳重新计时。也可以改用本机的目录文件。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_URL` | 安装地址不是公网 https：{detail} | 只安装公网 https、443 端口的 zip。内网和本机地址默认拒绝。本机文件可以直接给出路径，包括 Windows 盘符和 UNC。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_HASH` | zip 的 SHA-256 对不上，或者没有给出：{detail} | https 安装必须带 --sha256（或目录条目里的 sha256）。哈希不对就不要安装。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_SIZE` | zip 超过大小上限，或和目录里写的字节数不一致：{detail} | 一个插件不超过 200 MB。目录里的 bytes 要和 zip 的实际大小一致。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_TIMEOUT` | 下载超时：{detail} | 检查网络后重试。zip 最长等 60 秒，目录最长等 20 秒。这一次等待包含连接、重定向和正文，不是每一跳重新计时。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_FETCH` | 下载失败：{detail} | 确认地址能打开，并且返回的是 zip（HTTP 200）。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_REDIRECT` | 下载被重定向到了非公网地址、非 443 端口，或重定向次数太多：{detail} | 只跟随公网 https、443 端口的重定向，最多 5 次。请换一个直接的 https 地址。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_ZIP` | 这个 zip 不能安装：{detail} | zip 里要有 plugin.json（可以包在一层以插件 id 命名的文件夹里）。不能有路径穿越、符号链接、加密或超量的文件。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_CHECK` | 插件没通过检查，没有装进 plugins/：{detail} | 按 node tools/plugin.mjs check 的提示改插件，再安装。失败时只删掉临时文件，不会动已经装好的插件。 |
| 工作台里的操作被拒绝，旁边显示原因 | `PLUGIN_INSTALL_EXISTS` | plugins/ 里已经有这个 id：{detail} | 不加 --force 就不会覆盖。--force 会把旧文件夹挪到 plugins/_replaced/，不会删除。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_INPUT` | 这不是一份能读的 Forge 包：{detail} | 选一个含 pack.json 的工坊包目录，或那个目录打出来的 zip。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_ZIP` | 这个包的文件不安全，没有解压：{detail} | 路径不能跳出包目录，不能有符号链接，单个包最多 5000 个文件、一共 200 MB。换一份包再导入。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_JSON` | 包里的 JSON 读不了：{detail} | JSON 要能解析，不超过 8 MB，嵌套不超过 64 层，数字在 ±1e9 以内。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_ID` | 这个包的 id 变不成插件 id：{detail} | 用 --id 指定一个插件 id：2–32 位小写字母、数字和 -，例如 rose-skin。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_EXISTS` | 目标文件夹已经存在，没有写入：{detail} | 换一个 --out 或 --id，或者把已有的插件文件夹挪走后再导入。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_FORGE_SCRIPT` | 包里的脚本没有导入，也没有执行：{detail} | kits/<id>.js 的 id 是包里导入的记录（或 overrides 里声明的官方 id），import 又能映射到 sp:sdk@1（@kit/tier1.js、@sim/constants.js、@sim/detmath.js、包里的 ./ 文件）时，会变成沙箱里的脚本插件；不然就把技能逻辑改写成 JSON SkillSpec、DSL 或脚本插件。导入器不会运行包里的 .js。 |
| 插件没出现在列表里（被跳过）；启动日志和 check 写着原因 | `PLUGIN_INVALID` | 插件有问题：{detail} | 看后面的英文原文；看不懂的话，可以到 GitHub 提问并附上这段文字。 |
<!-- plugin-errors:end -->

## 从 Forge 包导入

如果你有一份 Forge 工坊包（一个带 `pack.json` 的文件夹，或它打出来的 zip），可以把对得上的部分导成我们的插件。

在工作台里点 **「从 Forge 包导入」**。选一个 zip，或选整个文件夹。先看导入报告，确认之后才会写入 `plugins/`。
报告里写着导入了什么、改成了什么、没导入的和原因。常见的没导入原因：这是服务端逻辑、会改协议、是一段对不上的脚本
（导入器**不运行**包里的任何代码），或者挂载点对不上我们的界面插槽。

命令行做同一件事：

```bash
node tools/plugin.mjs import-forge <工坊包目录或 zip> [--out plugins/<id>] [--id <id>] [--dry-run] [--json] [--no-scripts]
```

`--dry-run` 只打印报告，不写文件。皮肤、立绘、头像、图标、Spine、语音、对得上的音乐和音效会变成外观插件；数值改动、
新干员、`chess.json` 里成对的新棋子（`_a` 普通、`_b` 精锐；`isDiy` 的六星写成自选）和新敌人会变成数据插件；界面词条
会变成语言包；公告和鸣谢写进清单的说明。对不上的部分留在 `IMPORT-REPORT.md` 里，中文和英文各一行。

技能怎么办：

- 干员或棋子的技能 id 全是**同一名官方干员**的官方技能时，记录保留这些 id，直接用那名干员在本游戏里的 kit（克莱门莎这类
  自选干员用她的自选 kit，棋子用对应官方棋子的 kit）。只对上一部分，或者对上好几名干员，就用通用 kit，报告写明原因。
- 包里的 `kits/<棋子 id>.js` 行为脚本会合成一个**脚本插件** `kits-<id>`：每个文件一个作用域，`@kit/tier1.js`、
  `@sim/constants.js`、`@sim/detmath.js` 改成 `sp:sdk@1`，包里 `./` 开头的文件一起带上。别的 import（`@kit/tier3.js`、
  `@sim/dir.js` 之类）映射不过来，那份脚本就不写，报告里点名。导入时**不执行**它。
- 这个脚本插件**只在服主设置 `SP_PLUGIN_SCRIPTS=sandbox`（或受信任模式）并且房间选中它时**才运行（SES 沙箱，见下一节）。
  没开脚本的服务器照样能用数据插件，只是那名干员用通用 kit（或官方 kit）。
- 不想要脚本插件：命令行加 `--no-scripts`，或在工作台里勾选「不生成脚本插件」。
- 写 kit 的作者注意：天赋的 `install` 里加 buff 要写 `allowDead: true`（常驻的再加 `persist: true`，和 `kit.statBuff` 一样）。
  开战前干员还没部署，没写的 buff 会被引擎拒掉（Forge 的引擎也是这条规则）。报告会点名这样的 kit；Forge 自带的
  `kit-demo` 示例就是一例，导入后它的「攻击力 +25%」不生效。

完整对照表在 [PLUGINS.md](PLUGINS.md) §16。

## 开启脚本插件

「脚本插件」模板会生成示例技能和作者测试。用编辑器修改后运行：

```bash
node tools/plugin.mjs check my-script --strict
node tools/plugin.mjs pack my-script
node tools/plugin.mjs test my-script
```

`test` 会在本机执行作者的测试代码，不受服务器沙箱开关和受信任哈希许可限制；它不是生产环境的安全检查。
正式房间默认不开脚本。服主设置 `SP_PLUGIN_SCRIPTS=sandbox` 后（也可以启动时加 `--scripts sandbox`，Windows 上直接
双击 `scripts\start-windows-sandbox.bat`），`script` 类在 SES 沙箱中运行，浏览器用 Worker，服务器用受限子进程；要求锁文件与全部文件一致，不要求每位玩家逐个同意，也允许公网监听。修改文件后需重新打包。

`trusted` / `trusted-force` 是原生受信任执行：服主审查文件后，在 `plugins/config.json` 的 `trusted` 中填写锁文件
SHA-256，每位在座玩家也要同意。公网、`0.0.0.0` / `::` 通配监听或公网反代需 `trusted-force`。
第一次应用未缓存的脚本时，每个插件最多探测 5 秒，可能让大厅短暂停顿；`SP_SCRIPT_PROBE_MS` 可调整。
详细限制见 [PLUGINS.md](PLUGINS.md) §13 和[部署指南](DEPLOY.md)。数据插件里的 DSL 不需要开启这个开关。

## 按地址或社区目录安装

工作台点 **「从目录安装」**，填社区提供的目录 HTTPS 地址，或选择本机的目录 JSON 文件，查看版本和兼容性再安装。
目录里的每个下载都带 zip 的 SHA-256，由服务器下载并校验。项目不托管这些插件。

命令行也能安装本地 zip、按地址下载或查看目录：

```bash
node tools/plugin.mjs install ./my-skin-1.0.0.zip
node tools/plugin.mjs install https://example.invalid/my-skin.zip --sha256 <发布者提供的64位哈希>
node tools/plugin.mjs catalog ./catalog.json
```

示例域名不可下载，请换成发布者给的地址。远程下载默认只接受公网 HTTPS 的 443 端口。
同名插件默认不覆盖；需要替换时加 `--force`，旧目录会移到 `plugins/_replaced/`，不会删除。
安装检查不执行包里的代码；安装脚本插件也不代表它已经获准运行。完整规则见 [PLUGINS.md](PLUGINS.md) §17。

## 一次删除好几个插件

工作台左边的插件列表里，每个插件前面有一个**勾选框**。勾上不要的插件（「全选」一次勾上全部，「清除选择」全部取消），再点
**「删除所选（N）」**。确认框会列出这些插件的名字和 id；点「删除」后，它们的文件夹被移到服务器的 `plugins/_removed/` 文件夹里，
**不会被彻底删掉**：文件夹名后面加上了删除的时间，例如 `my-texas-20261015-083000-123`。想恢复某个插件，就把它的文件夹从
`plugins/_removed/` 移回 `plugins/`，把名字改回插件 id（去掉后面的时间），刷新页面就又能看到它。确定不要了，再自己清空
`plugins/_removed/`。

**正在使用的插件不会被删除**：某个房间开着它（正在对局也算）时，它留在原处，工作台会列出它和原因（带房间号），勾选也会保留；
等房间解散，或者房主在房间的插件面板里关掉它以后再删。符号链接的插件文件夹不能勾选，工作台不会移动它。玩家在自己浏览器里开的
外观插件和界面插件（设置里的开关）不算正在使用：删掉以后，它在那位玩家的浏览器里不再生效，恢复后又会生效。

## 进阶

- 字段的完整说明：[PLUGINS.md](PLUGINS.md) §3（清单）、§4（权限）、§5（文件和上限）、§9（外观插件）、§15（工作台与工具，包括工作台的 API）。
- JSON Schema：`schemas/plugin.schema.json`、`schemas/overlay.schema.json`、`schemas/records.schema.json`、`schemas/dsl.schema.json`、`schemas/ui.schema.json`；稳定与实验接口见 [PLUGIN-API.md](PLUGIN-API.md)。
- 让 AI 帮你做插件：请它先读 `plugins/AGENTS.md`，用 `node tools/plugin.mjs check --json` 自己检查。

## 截图从哪里来

本仓库不放截图（截图里有官方游戏的美术，按规矩不能进 git）。想看真实的截图，在装好美术素材的电脑上运行浏览器测试：

```bash
SP_E2E=1 node --test test/ui/studio.e2e.test.js
SP_E2E=1 node --test test/ui/studio-gameplay.e2e.test.js
SP_E2E=1 node --test test/ui/plugins-settings.e2e.test.js
```

截图会出现在 `test/e2e/out/` 里：`studio-start.png`（工作台首页）、`studio-templates.png`（选模板）、`studio-picker.png`（按名字搜索）、
`studio-preview.png`（拖入图片后的并排预览）、`studio-packed.png`（打包完成）。
