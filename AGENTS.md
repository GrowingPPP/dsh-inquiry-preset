# AGENTS.md — 维护者与 AI agent 的工作规范

面向**改这个仓库的人（和 agent）**。用户向的说明在 [README.md](README.md)，验证证据在 [VERIFICATION.md](VERIFICATION.md)。

---

## 这个项目是什么

一个**纯声明式**的 DSH agent preset：`cordis.patch.yml` 声明预设（persona + 技能包 + 压缩策略），
`skills/inquiry-task/` 是教学法。**没有任何代码会被加载**——`index.js` 只是个入口桩。

产品定位：把「有变量可调、有结果可看」的概念变成学习者亲手操作的**单个**探究任务。
不建课程层、不排进度、不做题库。

---

## 头号原则：这里的失败大多是静默的

这个仓库最容易浪费时间的不是"改错了"，而是**改错了却没有报错**。改任何东西之前先看这张表：

| 你改了什么 | 后果 | 有没有报错 |
| --- | --- | --- |
| 技能目录路径表达式 | 技能不出现 | **零日志**（目录不存在时 `listSkillRootEntries` 返回空数组） |
| `SKILL.md` 的 frontmatter | 技能被跳过 | 只有一条 `logger.warn` |
| persona 用了未注册变量（如 `{{cwd}}`） | 预设行激活失败 | 抛错，但只在挂载时 |
| 给 `package.json` 加 `exports` | **技能静默消失** | `ERR_PACKAGE_PATH_NOT_EXPORTED`，只在挂载时 |
| 删掉 `index.js` | 市场预检拒收 | 装前预检报"缺入口文件" |
| `plot` 没给 `yMax` | 峰值被切在框外 | **无任何报错** |
| `plot` 表达式写错（自变量用了 `t`、隐式乘法 `gt`） | 曲线整族不画 | **无任何报错**，`validate_dsh_ui` 照样回 `valid` |
| `series` 用了 `name` 而非 `label` | 图可能不渲染 | **无任何报错** |
| 改了 `cordis.patch.yml` 没重启 | 旧行为照旧 | 无报错，看起来像"改动无效" |

**所以：改完不算完，必须跑验证。**

---

## 验证三件套（改完必跑）

```bash
# 1. 技能发现链路逐环探针 —— 退出码 0 才算过
node tools/probe-skill-dir.mjs

# 2. 组装树里预设行是否正确
dsh --profile web --dump-config | grep -A40 'dsh-inquiry-preset'
# → plugin_manager list_plugins，确认 entryId = include:preset-inquiry 且 fiberPhase = active
```

**别用手写脚本"模拟"环境。** 本仓库踩过一次：用手写的 `createRequire` 脚本模拟路径解析，
得出"对 baseUrl 免疫"的**错误**结论；改用 `cordis-plugin-loader` 自己导出的 `interpolate`
跑表达式原文，才暴露出失败面。**凡是猜环境的验证都不可信。**

---

## 端到端自测（不用等人）

`~/.dsh/profiles/inquiry-test/` 是一个隔离的测试 profile，**已有可用的模型网关配置**。

```bash
# 1. 让它读本地实时改动（否则读的是 GitHub 上的快照）
dsh plugin --profile inquiry-test add link:/Users/ian/Desktop/project/ai-explore-project/interactive-learning-dsh-preset

# 2. 起实例（后台任务），从 stdout 抓带 token 的 URL
dsh inquiry-test --host 127.0.0.1 --port 3099 --no-open

# 3. 用 ego-browser 驱动，跑完 task.finish({ keep: [] })
```

**流程里的坑（都踩过）：**

- 新会话**默认回到标准模式**，每次都要重新选「探究模式」
- 输入框是 `contenteditable` 的 `div`，不是 textarea —— 用 `click` 聚焦 + `keyboard.insertText`
- 模型有时会把图**锁在预测表单后面**，要先填单选 + textarea（`已选 2/2`）再提交
- 页面右侧有「搜索会话名称」输入框，**别把测试文本填进去**（`page.fill` 的 `>> nth=0` 会命中它）
- 应用会自己锚定滚动，**截图常常拍不到图**。用 DOM 取值判断（如 y 轴刻度文本），比截图可靠
- **截图给公开用途前，必须先收起侧边栏**（`button[aria-label="收起侧边栏"]`）。
  侧边栏里有用户的其他**工作区名和会话标题**，拍进去就是把别人的项目列表公开了。
  收完后用 `document.body.innerText` 断言那些名字都不在，再截
- **换了 README 里的图片，必须同时改文件名。** GitHub 把 README 图片经
  `camo.githubusercontent.com` 按 **URL** 缓存——文件内容变了但路径没变时，
  页面会继续显示旧图（本地和 `raw.githubusercontent.com` 都是新的，只有渲染出来的那张是旧的）。
  `git mv docs/demo.png docs/demo-2.png` 这样换个名字，URL 变了缓存才会失效
- 验证完记得 `job_kill` 实例、确认 3099 释放，**不要影响用户正在用的 3080**

---

## 发版

```bash
# 1. 改 package.json 的 version + 写 CHANGELOG.md
# 2. 推送
git add -A && git commit -m "..." && git push
# 3. 打 release —— 这一步才让已安装的用户看到"有更新"
gh release create vX.Y.Z --title "..." --notes "..."
```

**三条必须记住的：**

1. **`release tag` 才是更新信号。** 市场对比的是 release tag；没有 release 就回退到 `pushed_at`——
   那样你**每推一次**（哪怕改个错字）都会让所有用户看到更新提示。
   `package.json` 的 `version` 字段对更新检测**毫无作用**（git 依赖的 spec 不带版本）。
2. **`git push` 会挂死。** 本机 `credential.helper=osxkeychain` 在非交互环境等钥匙串解锁，
   `--no-verify` 没用（不是钩子）。用一次性覆盖：
   ```bash
   git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main
   ```
3. **CLI 升级立刻生效，市场角标不是。** 市场要等每日刷新抓到新 `vr` 才会显示「更新」。

---

## 跨版本兼容性测试（隔离环境，不动用户安装）

改了 `cordis.patch.yml` 里任何 **官方包的配置字段** 之后，必须确认目标 DSH 版本上这些字段还在。
**隔离做法**（全程不碰全局安装、不碰用户的 profile）：

```bash
# 1. 在临时目录装目标版本（不要 -g，不要 npm link）
mkdir -p /tmp/compat-dsh && cd /tmp/compat-dsh && npm init -y && npm i @deepseek-ai/dsh@<版本>

# 2. 用隔离的 DSH_HOME
export DSH_HOME=/tmp/dsh-compat-home
BIN=/tmp/compat-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js

# 3. 关键：先让 profile「正常建出来」，再装本插件
node $BIN --profile web web --host 127.0.0.1 --port 3097 --no-open   # 建 profile（缺参数报错也会建）
node $BIN plugin --profile web add github:GrowingPPP/dsh-inquiry-preset

# 4. 判据：启动时【一条告警都不该有】
node $BIN --profile web --host 127.0.0.1 --port 3097 --no-open
#    有告警 = 有问题，例如：
#      preset-inquiry (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)
```

**最大的坑：profile 不能只用 `dsh plugin add` 建。** 那样建出来的 profile 只有 `@deepseek-ai/dsh-base`，
而 **`agentPresets` 服务由 `@deepseek-ai/dsh-web-app` 提供**（`dsh-base` 的 patch 里没有它）。
于是本预设会停在 `pending`，看起来像兼容性问题，**其实是测试搭台错了**。
正常走 `dsh web` 建出来的 profile 是 `dsh-base + dsh-web-app`，两个都有。

先比配置面再跑端到端，比直接跑省时间：

```bash
npm pack @deepseek-ai/dsh-persona@<版本>   # 然后看 lib/types/*.d.ts 里的 Config
```

本预设用到的全部配置面（改官方包配置时对照这张表）：
`dsh-agent-preset` 的 Config（id/name/description/order/plugins）、`persona.prefix`、
`skill-filesystem.customSkillDirs`、`tool-web.fetch`、三个压缩包的 `thresholdChars/headChars/tailChars`、
以及 `cordis-plugin-loader` 的 `!!js` 求值器。

---

## 文案口径（别改回去）

**两份 README 必须同步。** `README.md`（中文）是主版本，`README.en.md` 是它的逐节翻译——
改一边就要改另一边。判定方法：

```bash
paste <(grep '^## ' README.md | sed 's/^## //') \
      <(grep '^## ' README.en.md | sed 's/^## //') | column -t -s $'\t'
```

两列应当一一对应；节数与 `^### ` 小节数也应相同。**只改中文版就提交，等于让英文读者看到过期内容**——
这条已经犯过一次。

| 用 | 不用 | 为什么 |
| --- | --- | --- |
| **预测** | 押注、赌 | "押注"带赌博色彩，且与英文 `predict-*` 对不上。实测中**模型自己仍会冒出"赌一把"**，但那是在它的措辞里；我们的文案不要跟着走 |
| **调** | 拧 | "拧"语域太重不自然 |
| 不点名第三方插件 | — | 本仓库只描述自己的做法。学到别人的教训就写教训本身，不写是谁 |

「押注」想承担的"承诺感"由别的说法承担：**"要他说出来"**——承诺感来自"在看结果之前必须表态"。

---

## 红线

- **不要给 `package.json` 加 `exports`**（会让技能静默消失）。真要加，必须同时显式导出
  `"./package.json": "./package.json"`。
- **不要删 `index.js`**（市场预检要求包根有可解析的入口文件）。
- **不要把竞品分析、策略、内部笔记提交进仓库。** 那类文档在仓库外的
  `../interactive-learning-dsh-preset-notes/`，`.gitignore` 里也挡了一道。
- **改 `cordis.patch.yml` 后必须在【新建会话】里验证**——已有会话保持启动时的插件 revision。
  技能正文（`skills/` 下）由 watcher 自动拾取，但预设配置改动要重启宿主。

---

## 技能发现路径为什么写得那么绕

`cordis.patch.yml` 里 `customSkillDirs` 那个近 500 字符的 `!!js` 表达式不是过度设计，是**实测逼出来的**：

`baseUrl` 是**树级**属性，不是 bundle 目录。以 profile 为 `baseUrl` 时"按包名解析"成立；
以 bundle 自身目录为 `baseUrl` 时它失败、而"相对 URL"写法成立。**两种策略互补，且猜错完全静默。**

所以现在的写法是：列出候选，**按目标文件是否真的存在**挑选。

改动它之前，先用 `node tools/probe-skill-dir.mjs` 把四种 `baseUrl` 都跑一遍——
它会把每一种的解析结果打出来。
