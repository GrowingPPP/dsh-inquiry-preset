#!/usr/bin/env node
/**
 * 技能目录探针 —— 回答一个具体问题：探究模式的 `inquiry-task` 技能，能不能被 skill-filesystem 扫到？
 *
 * 为什么需要它：这条链路上任何一环断了都是**静默**的。
 *   · 路径解析错 → 目录不存在 → listSkillRootEntries 走 isAbsentSkillPathError 返回 []，不报错、不打日志
 *   · frontmatter 不合规 → 只打一条 logger.warn 然后跳过
 *   · 包没链进 profile/node_modules → createRequire 抛错，但被我们的兜底吞掉
 * 所以技能"没出现"这个现象本身不指向任何一环。这个脚本把每一环单独验一遍。
 *
 * 用法（在项目根目录）：
 *   node tools/probe-skill-dir.mjs
 *
 * 退出码：0 = 全部通过；1 = 有环节失败（失败项会打印具体原因）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATCH = path.join(ROOT, 'cordis.patch.yml');
const SKILL_DIR = path.join(ROOT, 'skills', 'inquiry-task');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const PKG_NAME = 'dsh-inquiry-preset';

const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.HOME ?? '', '.dsh');
const PROFILE = process.env.DSH_PROFILE ?? 'web';
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', PROFILE);

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? `\n         ${detail}` : ''}`);
}

console.log(`\n技能目录探针\n  profile = ${PROFILE_DIR}\n  bundle  = ${ROOT}\n`);

// ── 1. 技能文件本身存在且 frontmatter 合规 ────────────────────────────────
console.log('[1] 技能文件');
check('SKILL.md 存在', fs.existsSync(SKILL_MD), SKILL_MD);

let front = null;
if (fs.existsSync(SKILL_MD)) {
  const src = fs.readFileSync(SKILL_MD, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m) {
    check('有 YAML frontmatter', false, '文件开头没有 --- 包围的 frontmatter');
  } else {
    check('有 YAML frontmatter', true);
    // 只做形状检查，不引入 YAML 依赖
    const body = m[1];
    const name = /^name:\s*(.+)$/m.exec(body)?.[1]?.trim();
    const desc = /^description:\s*(.+)$/m.exec(body)?.[1]?.trim();
    check('frontmatter 有 name 与 description', Boolean(name && desc), `name=${name ?? '(缺)'}`);
    // 与 dsh-skill/lib/index.js:17 的 SKILL_NAME 一致
    const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    check('技能名符合 SKILL_NAME 正则', Boolean(name && SKILL_NAME.test(name)), `正则 /^[a-z0-9]+(?:-[a-z0-9]+)*$/`);
    // 这三个旧驼峰名会让 parseInvocationPolicy 直接 throw（dsh-skill-filesystem/lib/index.js:853-855）
    const legacy = ['disableModelInvocation', 'modelInvocable', 'userInvocable'].filter((k) => new RegExp(`^${k}\\s*:`, 'm').test(body));
    check('未使用会 throw 的旧驼峰字段名', legacy.length === 0, legacy.length ? `发现: ${legacy.join(', ')}` : '');
    // 单条 skill 渲染后要低于 tool-result-pruner 的 8192 阈值
    const chars = [...src].length;
    check('SKILL.md 字符数 < 8192', chars < 8192, `${chars} 字符`);
    front = { name, chars };
  }
}

// ── 2. 包是否链进 profile/node_modules（按包名解析的前提）────────────────
console.log('\n[2] profile 里的包链接');
const linked = path.join(PROFILE_DIR, 'node_modules', ...PKG_NAME.split('/'));
let linkedOk = false;
try {
  linkedOk = fs.existsSync(path.join(linked, 'package.json'));
} catch { /* 忽略 */ }
check(`profile/node_modules 里有 ${PKG_NAME}`, linkedOk, linkedOk ? fs.realpathSync(linked) : `缺 ${linked}`);

// ── 3. 用 loader 的真实求值器跑 patch 里的真实表达式 ──────────────────────
console.log('\n[3] patch 里的路径表达式（用 loader 自己的求值器）');
let interpolate = null;
try {
  const mod = await import(
    path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
  );
  interpolate = mod.interpolate;
  check('导入 cordis-plugin-loader 成功', true);
} catch (error) {
  // 回退：从 dsh 安装目录找
  try {
    const { execSync } = await import('node:child_process');
    const dshRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const mod = await import(path.join(dshRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js'));
    interpolate = mod.interpolate;
    check('导入 cordis-plugin-loader 成功', true, '（从全局 dsh 安装目录）');
  } catch (error2) {
    check('导入 cordis-plugin-loader 成功', false, String(error2).slice(0, 120));
  }
}

if (interpolate) {
  const src = fs.readFileSync(PATCH, 'utf8');
  const expr = /!!js\s+(\S.*)$/m.exec(src)?.[1]?.trim();
  if (!expr) {
    check('从 patch 取到 !!js 表达式', false);
  } else {
    check('从 patch 取到 !!js 表达式', true, `${expr.length} 字符`);
    // 把 baseUrl 的各种可能形态都试一遍——真实取值取决于 loader 的树层级
    const bases = [
      ['profile 目录', `file://${PROFILE_DIR}/`],
      ['profile patch 文件', `file://${PROFILE_DIR}/cordis.patch.yml`],
      ['bundle 自身目录', `file://${ROOT}/`],
      ['链接包内的 patch', `file://${linked}/cordis.patch.yml`],
    ];
    let anyResolved = false;
    for (const [label, baseUrl] of bases) {
      try {
        const out = interpolate({ baseUrl }, { __jsExpr: expr });
        const dir = Array.isArray(out) ? out[0] : out;
        const ok = typeof dir === 'string' && fs.existsSync(path.join(dir, 'inquiry-task', 'SKILL.md'));
        if (ok) anyResolved = true;
        console.log(`${ok ? '  OK  ' : ' FAIL '} baseUrl=${label}\n         -> ${dir}`);
      } catch (error) {
        console.log(` FAIL  baseUrl=${label}\n         -> ${String(error).split('\n')[0].slice(0, 100)}`);
      }
    }
    check('至少一种真实 baseUrl 解析到技能目录', anyResolved,
      anyResolved ? '' : '两种策略都失败——检查包是否链进 node_modules、或 baseUrl 是否是意料之外的形态');
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? '全部通过' : `${failed.length} 项失败`}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
}
console.log('\n注意：本探针只验证【技能能否被扫到】。预设是否出现在模式列表、persona 渲染、');
console.log('端到端教学循环，都必须在【新建的探究模式会话】里看——本探针不能替代那一步。\n');
process.exit(failed.length === 0 ? 0 : 1);
