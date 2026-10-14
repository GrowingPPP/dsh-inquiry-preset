/**
 * 这个包是**纯声明式**的：它只提供一个 agent preset（`cordis.patch.yml`）+ 一组技能
 * （`skills/`），不注册任何 Cordis 插件行，因此**没有任何代码会被加载**。
 *
 * 那为什么还需要这个文件？因为 DSH 插件市场的装前预检会从包根解析一个入口文件：
 * `exports["."]` → `main` → 兜底 `index.js`，三者都拿不到就判定"缺入口文件"并拦下安装。
 * 这个包本来三个都没有，于是会被自己的市场拒收。
 *
 * 所以它的唯一作用是：让入口解析有一个真实存在的文件可指。
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
export {}
