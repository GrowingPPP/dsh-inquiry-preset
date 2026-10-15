/**
 * 这个包是**纯声明式**的：它只提供一个 agent preset（`cordis.patch.yml`）+ 一组技能
 * （`skills/`），不注册任何 Cordis 插件行，因此**没有任何代码会被加载**。
 *
 * 这个文件的存在有两个理由，都是"包装"层面的，与运行时逻辑无关：
 *
 * 1. **市场装前预检**会从包根解析一个入口文件：`exports["."]` → `main` → 兜底 `index.js`。
 *    三者都拿不到就判定"缺入口文件"并拦下安装。
 * 2. **市场收录要求**里有"插件需导出 `apply(ctx)` 模块"一条。本包是 bundle 而不是插件行——
 *    结构上等同于官方的 `@deepseek-ai/dsh-base`（它的入口也是 `export {}`），`apply` 不会被调用。
 *    这里提供一个，只是为了满足该项形态检查。
 *
 * 两条不能动的约束：
 *
 * 1. **不要给 package.json 加 `exports` 字段。** 本包的技能目录路径靠
 *    `createRequire(baseUrl).resolve('dsh-inquiry-preset/package.json')` 解析
 *    （见 `cordis.patch.yml`），而 `exports` 一旦存在，子路径访问默认被封锁，
 *    会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，表现是**技能静默消失**。
 *    若确实要加 `exports`，必须同时显式导出 `"./package.json": "./package.json"`。
 * 2. **不要删这个文件**，否则市场预检会拒收（尽管它从未被 import）。
 */

/**
 * 正常路径下**永不被调用**的插件入口，仅为满足市场的插件形态检查而存在。
 *
 * 万一真有人把本包当作插件行挂载（那是误用），这里**出声**而不是静默什么都不做——
 * 本项目的头号原则是"不要让失败静默"。
 *
 * @param {import('@deepseek-ai/cordis').Context} [ctx] Cordis 上下文。
 */
export function apply(ctx) {
  ctx?.logger?.warn?.(
    '[dsh-inquiry-preset] 本包是 bundle（预设 + 技能），不是插件行。'
      + ' 预设声明在 cordis.patch.yml，由 dsh.bundle.patch 装载。'
      + ' apply() 不该被调用——看到这条说明有人把它当插件行挂载了。',
  )
}
