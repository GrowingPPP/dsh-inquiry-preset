# 验证记录：探究模式 preset 的装配

- 日期：2026-10-14
- DSH 版本：0.2.1-alpha.2
- Profile：`web`
- Bundle：`@local/dsh-inquiry-preset@0.1.0`（工作区内 `preset/`，以 `link:` 装入）

## 结论

**全部通过，含端到端实测。**

- **装配层**：预设声明合法、行已激活、组装树正确、技能目录路径在四种真实 `baseUrl` 下均解析成功。
- **静态层**：技能名与 frontmatter 合规、persona 变量引用全部已注册、内嵌 `dsh-ui` 示例 spec 语法合法。
- **端到端**（2026-10-14 由项目作者在 Web UI 实测）：技能确实被加载并影响模型行为、模型确实先问预测再给图、
  `dsh-ui` 围栏确实渲染成带参数滑块的曲线图。

首次实测**未发现功能性问题**；暴露的是一个文案问题（「拧」语域不自然），已修复。

## 逐项证据

| # | 检查项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | YAML 结构合法 | 用 `yaml` 解析（剥掉 `!!js` 标签做结构校验） | ✅ 通过；`row.id=preset-inquiry`、`config.id=inquiry`、5 个子行 |
| 2 | `persona` 用对字段 | 对照 `dsh-persona/lib/index.js:24` 的 `prefix: z.string().required()` | ✅ 用 `prefix`，未用 `text` |
| 3 | 无未注册的 prompt 变量 | 全仓 `grep '\.variable("'` → 仅 `model` / `provider` | ✅ 只用 `{{model}}` |
| 4 | Bundle 安装 | `plugin_manager install_bundle` | ✅ `enabled: true`，pnpm exit 0 |
| 5 | 预设行激活 | `plugin_manager list_plugins` | ✅ `include:preset-inquiry` → `fiberPhase: active` |
| 6 | 进组装树 | `dsh --profile web --dump-config` | ✅ 5 个子行齐全，顺序与内容正确 |
| 7 | `!!js` 标签被识别 | 同上，表达式中 `!!js` 被保留未求值 | ✅ 符合"子插件加载时求值"的语义 |
| 8 | 技能目录落点 | 用官方同款表达式在三种 `baseUrl` 形态下解析 | ✅ 三种都落到 `preset/skills/` |
| 9 | SKILL.md 体积 | `wc -m` | ✅ 2140 字符 < 8192（tool-result-pruner 阈值） |

## 两个关键写法（都是踩过坑的）

### 技能目录：按**包名**解析，不要用相对 URL

采用官方 creator 预设（`@deepseek-ai/dsh-web-app/presets/cordis.patch.yml:138`）的写法：

```yaml
customSkillDirs:
  - !!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@local/dsh-inquiry-preset/package.json')), 'skills')
```

**为什么不能用 `new URL('skills/', baseUrl)`**：那个写法隐含假设 `baseUrl` 恰好等于 bundle 目录。实测 `baseUrl` 至少可能是 profile 目录，一旦猜错，路径指向一个不存在的目录，**技能不出现且没有任何报错**——静默失效。按包名解析走 node_modules，对 `baseUrl` 的具体取值免疫。

实测三种形态都成功（`dsh --profile web --dump-config` 与下列 node 复现）：

```
file://<profile>/cordis.patch.yml                                  -> <bundle>/skills
file://<profile>/                                                   -> <bundle>/skills
file://<profile>/node_modules/@local/dsh-inquiry-preset/cordis.patch.yml -> <bundle>/skills
```

### `!!js` 的作用域

`cordis-plugin-loader/lib/index.js:233` 的实现是 `new Function("ctx","expr", "with (ctx) { return eval(expr) }")`。
所以**裸标识符会经 `with(ctx)` 解析到 ctx 的属性**——`baseUrl` 可以直接写（官方代码也这么写），不需要 `ctx.baseUrl`。

## 技能目录路径：一次真实踩坑与根因

第一版我照抄了一处社区常见写法：

```yaml
- !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

**这是错的**，而且错得隐蔽——猜错时技能不出现且零报错。根因是对照出来的：

| | 该写法的原生语境 | 本 bundle 第一版（错） |
| --- | --- | --- |
| `!!js` 所在文件 | 旧式预设目录里的 `agent.cordis.yml` | bundle patch 的**嵌套 `config.plugins`** |
| `baseUrl` 锚点 | 该预设目录 → `new URL('skills/', baseUrl)` 成立 | 树级 baseUrl → `<profile>/skills/` |
| 结果 | 在其语境下正确 | **静默失效** |

那个写法在它自己的语境里是对的（表达式就写在那个目录下的文件里），**搬到 bundle patch 的嵌套 config 里就失效了**——锚点完全不同。

### 证据

1. `cordis-plugin-loader/lib/index.js:432` 的诊断栈用 `entry.parent.tree.ctx.baseUrl`，说明 `baseUrl` 是**树级**属性；嵌套组（`EntryTree` 构造器 `ctx.extend({ baseUrl: ctx.baseUrl })`）继承父树。
2. `lib/index.js:605-609` 的 `internal/config` 钩子对**组行跳过插值**（`if ((this.runtime?.callback)?.[EntryGroup.key]) return config`），把子表达式的求值推迟到子行激活时——这正是"Preserve child expressions until their own plugins activate"。所以预设行 active **不能**证明子表达式求值成功。
3. 旧写法最可能的落点 `~/.dsh/profiles/web/skills` 与 `~/.dsh/skills` **都不存在**。

### 修正（第一版仍然不够）

先改成官方 creator 预设（`dsh-web-app/presets/cordis.patch.yml:138`）的按包名解析。
但我当时写的是"对 `baseUrl` 取值免疫"——**这话说过头了**，第二轮用 loader 的真实求值器实测后发现它有一个失败面。

### 用 loader 真实求值器实测（不是手工模拟）

`cordis-plugin-loader` 导出了它自己的 `interpolate` / `isJsExpr`。把 patch 里那条表达式的**原文**取出来，
按 loader 的形状（`{ __jsExpr: ... }`）构造节点，用**它自己的求值器**跑，对五种 baseUrl：

| baseUrl | 官方按包名写法 | 相对 URL 写法 |
| --- | --- | --- |
| `file://<profile>/` | ✅ | ❌（`<profile>/skills` 不存在） |
| `file://<profile>/cordis.patch.yml` | ✅ | ❌ |
| `file://<bundle 自身目录>/` | ❌ `Cannot find module '@local/dsh-inquiry-preset/package.json'` | ✅ |
| `file://<profile>/node_modules/@local/…/cordis.patch.yml` | ✅ | ❌ |
| `file:///tmp/` | ❌ | ❌ |

**结论：两种策略是互补的，没有一种单独覆盖全部。** 按包名解析要求 baseUrl 落在能向上走到 profile
`node_modules` 的位置；相对 URL 写法要求 baseUrl 恰好是 bundle 目录。**而猜错是完全静默的**——
`listSkillRootEntries` 对不存在的目录走 `isAbsentSkillPathError` 分支返回 `[]`（`dsh-skill-filesystem/lib/index.js:623-654`），
不抛错、不打日志。

### 最终写法：自校验的候选链

列出候选，按**目标文件是否真的存在**挑选，两种策略互补兜底：

```js
(() => {
  const N = process.getBuiltinModule('node:fs'), P = process.getBuiltinModule('node:path');
  const c = [];
  try { c.push(P.join(P.dirname(process.getBuiltinModule('node:module')
      .createRequire(baseUrl).resolve('@local/dsh-inquiry-preset/package.json')), 'skills')) } catch {}
  try { c.push(process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))) } catch {}
  return c.find((d) => N.existsSync(P.join(d, 'inquiry-task', 'SKILL.md'))) ?? c[0] ?? 'skills'
})()
```

同一套真实求值器实测：**四种真实 baseUrl 全部解析到 `<bundle>/skills`**（含此前唯一失败的那种），
只有 `/tmp/` 这种与本行无关的锚点仍然失败——那不是这条行会出现的 `baseUrl`。

表达式 483 字符，YAML 校验确认为单个 `string`、且不含会破坏 plain scalar 的 `: ` 序列。

## persona 变量插值（原"未验证项 2"，现已静态验证）

插值是**严格抛错**的（`dsh-system-prompt/lib/index.js:155-174`）：未知变量直接 throw 并列出已注册的变量名，
不完整的引用也 throw。规则：

| 规则 | 位置 |
| --- | --- |
| `VARIABLE_NAME = /^[a-z][a-z0-9_]*$/` | `:62` |
| `GROUP_AT = /^\{\{([^{}]*)\}\}$/` | `:63` |
| 未注册变量 → throw，并列出已注册名 | `:171` |
| 孤立的 `{{`（后面没有 `}}`）**按普通文本处理**，不算错 | `:109` |

已注册的变量名：全仓 `grep '\.variable("'` 只有 **`model`** 与 **`provider`**（`dsh-agent-loop/lib/index.js:1591-1592`）。

按上述规则忠实复刻检查器，跑真实的 patch 文本：

| 待测文本 | 变量引用 | 结果 |
| --- | --- | --- |
| **我们的 persona** | `{{model}}` | **PASS** |
| 反向对照：一段用了未注册变量的真实 persona | `{{model}}` `{{cwd}}` | **UNKNOWN variable `{{cwd}}`** |

反向对照确认了检查器确实能抓到错误——那段真实 persona 会因 `{{cwd}}` 未注册而激活失败
（它同时还有字段名错误：用了 `text` 而非必填的 `prefix`），这也是本项目只引用 `{{model}}` 的原因。

## 端到端实测（2026-10-14 由项目作者在 Web UI 亲自执行）

前三轮这三项**无法用静态手段验证**——共同前提是「一个使用 `inquiry` 预设的会话」。
宿主重启后由人实测，三项**全部通过**：

| 未验证项 | 实测观察 | 结论 |
| --- | --- | --- |
| `inquiry-task` 是否被扫到并加载 | SKILL.md 里的措辞（「拧」）**出现在模型回复中** | ✅ 技能确实加载，预设作用域的技能发现成立 |
| 是否真的"先问预测再给图" | 提问「万有引力」，**模型先要求预测** | ✅ 核心循环守住（persona 三条硬规矩 + 技能第 1 步生效） |
| `dsh-ui` 围栏是否落地 | **渲染出带参数滑块的曲线图** | ✅ genui 在 DSH 0.2.1 上可用，DOM channel 匹配成功 |

补充：测试主题是**万有引力**，落在"改一个量看结果变"的目标领域内。

### 首次实测暴露的唯二问题

一次功能性问题都没有；暴露出来的是**文案问题**：

- SKILL.md / persona / README 里的「**拧**」（"有变量可拧、有结果可看"）被判定为语域太重、不自然。
  已全文替换为「**调**」（"有变量可调、有结果可看"），共 5 处 3 个文件。
  **这类问题静态验证抓不到——只有真人读到才发现。** 这是"零代码起步"路线把成本压到最低的价值所在：
  改 5 个词，`watch: true` 下 SKILL.md 部分无需重启即生效。

### 曾为完成这三项试过、但走不通的路径（记录以免重复劳动）

- `dsh headless`：跑在 `dsh-base` 上，**不含** `agent-preset-registry`，预设根本不参与组合。
- `agentPresets.inspectCompositions()`：能返回每行的 `fiberState`，正是需要的——但 `cordis_inspect_query`
  **不能调用业务 Service 方法**（工具说明明确写了），只能读契约。
- web API（`agentPresets/list` 等 Remote）：需要 activation secret 签名的 cookie。
  **伪造 cookie 属于规避产品自身的安全边界，即使本机、即使只为调试也不做。**
  同理未使用 `dsh-pocket` 的配对 token 走旁路。
- 起第二个实例：会用同一 profile，且不解决"我无法驱动 UI 建会话"的问题。

**结论：这一步只能由人来做。**

> ### ⚠️ 一般的坑：patch 改动要重启才生效
>
> `cordis.patch.yml` 的改动**不会热进运行中的实例**——宿主持着启动时那份 revision。
> 所以验收前先核对宿主启动时间，否则会把"旧表达式导致的假阴性"误判成设计问题：
>
> ```bash
> ps -eo pid,lstart,command | grep "dsh web"   # 启动时间早于你改 patch 的时间 → 结果不算数
> ```
>
> 验收顺序：
> 1. 新建会话 → 模式列表里有没有「探究模式」
> 2. 技能目录里有没有 `inquiry-task`（没有就先跑 `node tools/probe-skill-dir.mjs`）
> 3. 说「我想搞懂阻尼振动」→ 它应当**先问一个可证伪的预测**，再给带滑块的图

## 跨版本兼容性：官方 `latest`（`0.2.0-rc.2`）实测（2026-10-15）

**背景**：本文件其余部分全部是在 `0.2.1-alpha.2` 上验的。但 npm 上 `@deepseek-ai/dsh` 的
`latest` 标签指向 **`0.2.0-rc.2`**，而 `0.2.1-alpha.*` 是**更靠后的另一条 alpha 线**——
两条线代码不同。用官方版的人拿到的是一个**更旧**的代码库，所以必须单独验。

这不是假想的风险：本项目的调研阶段就发现过一个同类插件因为
`0.1.x → 0.2.x` 之间的格式变更（`.agent-presets` 目录被废弃、`persona.text` 改名 `prefix`）而完全跑不起来。

### 结论：通过

在**隔离环境**中完成（临时目录装 0.2.0-rc.2、`DSH_HOME` 指向 `/tmp`，全程未触碰全局安装与用户的 profile）。

### 证据 1：用到的配置面逐项比对，六项全部同形

从 npm 拉 `0.2.0-rc.2` 的对应包，直接读类型定义与 Config schema：

| 配置面 | 0.2.0-rc.2 的结果 |
| --- | --- |
| `dsh-agent-preset` 的 Config | `{id: required, name, description, order, plugins: required}` —— **逐字相同** |
| `dsh-persona.prefix` | 仍是 `prefix: string`（必填），未回退成 `text` |
| `dsh-skill-filesystem.customSkillDirs` | `customSkillDirs?: string[]` 仍在 |
| `dsh-tool-web` | `fetch?: boolean`、`searchTimeoutMs?: number` 均在 |
| 三个压缩包 | `dsh-compaction-basic` / `dsh-command-compact` / `dsh-compaction-tool-result-pruner` 在 `0.2.0-rc.2` 均存在，Config 含 `thresholdChars` / `headChars` / `tailChars` |
| `cordis-plugin-loader` 的 `!!js` 求值器 | `new Function("ctx","expr", \`with (ctx) { return eval(expr) }\`)` —— **完全一致**，本仓库那段候选链表达式依赖的 `with(ctx)` 与裸 `baseUrl` 行为不变 |

### 证据 2：装进去、启动、零告警

```bash
export DSH_HOME=/tmp/dsh-compat-home2
BIN=/tmp/compat-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
node $BIN --profile web web --host 127.0.0.1 --port 3097 --no-open   # 建 profile
node $BIN plugin --profile web add github:GrowingPPP/dsh-inquiry-preset
node $BIN --profile web --host 127.0.0.1 --port 3097 --no-open
# → dsh web: http://127.0.0.1:3097/?token=...      （一条告警都没有）
```

- bundle 自动注册：`@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-inquiry-preset`
- `--dump-config` 退出码 0，`# == dsh-inquiry-preset` → `preset-inquiry` 行在位，
  `config.id: inquiry` / `name: 探究模式` 正确
- **`did not activate` 计数 = 0**

对照：boot 时的告警就是激活失败的信号。本次排查中确实见过它报警的样子（见下）。

### 证据 3：技能发现探针在 0.2.0-rc.2 的 loader 上全通过

```bash
DSH_HOME=/tmp/dsh-compat-home DSH_PROFILE=compat \
NODE_PATH=/tmp/compat-dsh/node_modules node <installed>/tools/probe-skill-dir.mjs
# → 全部通过，退出码 0（四种 baseUrl 场景全部解析到技能目录）
```

### 排查中遇到的一个假警报（值得记下来）

第一次测出来是**失败**的：

```
dsh: warning: 1 entry did not activate
preset-inquiry (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)
```

一度看起来就是兼容性问题。追下去发现是**测试搭台错了**：
我用 `dsh plugin add` 建的 profile 走的是**最小模板**，`bundles` 里只有 `@deepseek-ai/dsh-base`，
而 **`agentPresets` 服务由 `@deepseek-ai/dsh-web-app` 提供**（`dsh-base` 的 `cordis.patch.yml`
里不含 `dsh-agent-preset-registry`，`dsh-web-app` 的含 2 处）。
正常走 `dsh web` 建出来的 profile 是 `dsh-base + dsh-web-app` 两个都有，因此不受影响。

**教训**：验证"能不能激活"之前，先确认 profile 是用**正常路径**建的。否则会把搭台错误
当成产品缺陷，然后去改本来没坏的东西。

### 证据 4：端到端教学循环（2026-10-15，在 `0.2.0-rc.2` 上实跑）

在同一个隔离实例里（rc.2 + 本插件 + 渲染器），用浏览器驱动跑了一轮完整会话。

**模式列表**：出现了「探究模式」，描述文案正确，可选中。

**提问**：「我想搞懂为什么单摆的周期和振幅无关」

**回复**——四条关键行为全部符合设计：

| 设计条款 | rc.2 上的实际表现 |
| --- | --- |
| 先要一个可证伪的预测 | "在往下看任何东西之前，先给出你的预测……这个比值大约是多少？"（要求**具体的数或很窄的区间**） |
| 要他说出来（不只是心里想） | "给我一个具体的数……**还要顺带告诉我：你这个数是怎么推出来的？**——这一步比数字本身重要" |
| 先讲最小必要概念 | 开头先点明"这是一个有前提条件的说法——前提是什么"，再给任务 |
| 降级路径 | 滑块标注说明"最小 0.5° 是为了避开图的左端点"；并给了播放动画这条替代操作 |

**渲染结果**：DOM 探测到 **1 个参数滑块 + 1 张大 SVG 曲线图**（非 canvas），
y 轴刻度 `0 / 0.2 / 0.4 / … / 1.2` 说明 `yMax` 被显式设定过（不是自动量程），
两条 series（真实周期比的红线 + 小角度公式的虚线参照）都在。

**结论：`0.2.0-rc.2` 上装配层、技能发现层、端到端教学循环三层全部通过。**

### 仍未验证的部分

- 其他平台（非 macOS）未验证。
- 只测了两个教学主题（阻尼振动、单摆）与一个统计主题（正态分布）；
  四种任务形态里 **C（单点探针）从未实际出场过**——多次实测中模型都选择了 A 或 B。

---

## 复现命令

```bash
# 一键探针：把「技能能否被扫到」这条链路的每一环单独验一遍
node tools/probe-skill-dir.mjs          # 退出码 0 = 全通过

# 结构预检
node -e "const y=require('<dsh>/node_modules/yaml');console.log(y.parse(require('fs').readFileSync('preset/cordis.patch.yml','utf8').replace(/!!js /g,'')))"

# 路径表达式（用 loader 自己的求值器，不是手工模拟）
node --input-type=module -e "
import fs from 'node:fs';
import { interpolate } from '<dsh>/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js';
const expr = /!!js\s+(\S.*)\$/m.exec(fs.readFileSync('preset/cordis.patch.yml','utf8'))[1].trim();
for (const b of ['file://$DSH_PROFILE_DIR/','file://$DSH_PROFILE_DIR/cordis.patch.yml']) {
  const d = interpolate({ baseUrl: b }, { __jsExpr: expr });
  console.log(fs.existsSync((Array.isArray(d)?d[0]:d)+'/inquiry-task/SKILL.md') ? 'OK  ' : 'BAD ', b);
}"

# 组装树（会启动一个 loader 进程并退出，不影响运行中的实例）
dsh --profile web --dump-config | grep -A40 'dsh-inquiry-preset'

# 行激活状态
# → plugin_manager list_plugins，找 entryId = include:preset-inquiry
```

## 为什么不靠"手工模拟"下结论

第一轮我用 `createRequire(...)` 手写脚本模拟解析，得出"对 baseUrl 免疫"——**这个结论当时是错的**，
因为模拟的输入是我自己挑的 baseUrl。第二轮改用 `cordis-plugin-loader` 自己导出的 `interpolate`，
把 patch 里表达式的**原文**喂给它，才暴露出 `baseUrl = bundle 自身目录` 这一种失败面。
**凡是"猜环境"的验证都不可信，要用真实代码路径跑。**

## 渲染器：dsh-genui 安装与 spec 校验

2026-10-14 补测。安装目标取自插件市场目录的权威字段 `ic`：

```
dsh plugin --profile web add @changfenhuang/dsh-genui
→ plugin_manager install_bundle target="@changfenhuang/dsh-genui"
```

结果：`@changfenhuang/dsh-genui@0.12.0`，`enabled: true`，`application: "applied"`（热生效）。
**旁证**：安装后本会话的技能目录立即出现了 `genui` 技能——说明 bundle 激活且技能提供者已注册。
另注：`render_ui` 与 `validate_dsh_ui` 两个工具随该插件注册。

### 版本兼容性（此前标记的风险）的实际结果

genui 声明支持 DSH `^0.1.2-rc.1 || ^0.1.5 || ^0.1.6 || ^0.1.7`，本机为 **0.2.1-alpha.2**，且 0.2.1 无
`fence-registry` 扩展点（本地 grep 确认零命中），因此它走 **DOM channel**。安装未被 peer 检查拦下，
技能已注册。**渲染是否真的落地需要肉眼确认**（见下）。

### 技能内示例 spec 的机器校验

用 genui 自带的 `validate_dsh_ui` 校验 `references/task-shapes.md` 里的示例，避免技能教模型写出坏围栏：

| 示例 | 结果 |
| --- | --- |
| 形态 A `plot`（阻尼振动，三参数滑块） | `status=valid`，`rendered=1` |
| 形态 D 卷子模式（2×radio group + submit 聚合） | `status=valid`，`rendered=3` |
| 形态 C 探针（slider+id+action）与 `quiz` | `status=valid`，`rendered=2` |

## SKILL.md 可解析性预检（消除"技能文件本身被拒"这一类静默失败）

`dsh-skill-filesystem` 对不合格的 SKILL.md 只打一条 `logger.warn` 然后**跳过**——所以文件写错也是静默的。逐条对照它的校验代码：

| 校验点 | 位置 | 我们的值 | 结果 |
| --- | --- | --- | --- |
| 必须有 frontmatter | `dsh-skill-filesystem/lib/index.js:679` | 有 | ✅ |
| `name` 与 `description` 必填 | 同上 `:685` | 都有 | ✅ |
| 技能名正则 | `dsh-skill/lib/index.js:17` → `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` | `inquiry-task` | ✅ 实测通过 |
| 旧字段名会 **throw** | 同上 `:853-855` | 未使用 | ✅ |

第 4 条注意：`disableModelInvocation` / `modelInvocable` / `userInvocable` 三个驼峰名会直接抛错，
正确写法是 `disable-model-invocation` / `user-invocable`。我们不需要调优调用策略，因此没写。

## `plot` 表达式的真实约束（读 `safe-math.d.ts` 得到，非推测）

genui 的表达式求值是手写递归下降解析器（**不用 eval / new Function**）。文法：

```
expr  := term (('+'|'-') term)*        term  := unary (('*'|'/'|'%') unary)*
unary := ('-'|'+') unary | power       power := atom ('^' atom)?
atom  := number | variable | constant | func '(' expr ')' | '(' expr ')'
variable: 'x'（以及 vars 里的**单字母**）   constant: pi | e | tau
func: sin cos tan asin acos atan sqrt cbrt exp log ln abs floor ceil round min max pow
```

两个结论：

1. **`^` 是支持的**（`power := atom ('^' atom)?`），`x^3`、`(x-m)^2`、`x^a` 都合法。
2. **参数只能是单个字母**——文法写的是"any single-letter variable present in vars"。
   多字符标识符（`sigma`、`alpha`、`rate`）是解析错误，而 `compileMathExpr` 返回 `null`，
   **表现为什么都不画且不报错**。

第 2 条已作为硬约束写进 `references/task-shapes.md`（含"表达式里每个字母都必须在 `params` 里声明"）。
本项目示例中的参数名（`A` `d` `w` `s` `m` `k` `a` `b` `c` `n`）全部符合。

## 备注

- 第二次 `install_bundle` 返回 `application: "restart-required"`（首次是 `applied`）。补丁内容变更需要宿主重启才进入运行中的实例；运行中的 host 仍持启动时的那份 revision。
- `list_plugins` 末尾出现了一个非本项目的 `preset-qa-mode` 行，来源不在本 bundle 内，未追查。
