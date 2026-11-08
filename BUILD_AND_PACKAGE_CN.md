# Cursor++ 构建、打包与本地 npx 安装

> 本文件保留为上游 Cursor++ / `@cometix/ccursor` 的通用构建参考。
> 当前 fork 使用 `@stomehero/ccursor@0.0.17-fix`，从 0 构建和发布请优先阅读
> [`BUILD_AND_PUBLISH_STOMEHERO_CN.md`](./BUILD_AND_PUBLISH_STOMEHERO_CN.md)。

本文记录 Cursor++ 的完整构建流程，适用于本仓库当前结构：

- `Cursor++/`：Cursor++ 扩展源码
- `installer/`：生成 `npx` 安装器的 Node.js CLI
- `installer/vsix/`：安装器内置的 Cursor++ 扩展包

本文重点解决以下问题：

- 如何重新构建 Cursor++ 扩展
- 如何生成 Cursor++ VSIX
- 如何生成可本地执行的 `npx` 安装包
- 如何验证本地 npx 包
- 如何发布成自己的 npm 包
- `pnpm`、VSIX、Cursor++ 安装器分别负责什么

> 注意：Cursor++ 安装器会修改 Cursor 内部文件。只安装 VSIX 不会自动完成 Cursor++ 的路由注入。

## 0. 环境准备

建议环境：

- macOS
- Node.js 18+
- npm
- pnpm
- 已安装 Cursor

本文示例使用：

```bash
export CBD_ROOT="$HOME/Personal/project/IdeaProjects/CBD"
export CCURSOR_ROOT="$CBD_ROOT/CCursor"
export APP_ROOT="/Applications/Cursor.app/Contents/Resources/app"
```

如果路径不同，按自己的实际目录修改。

检查工具：

```bash
node --version
npm --version
pnpm --version
```

## 0.1 从全新源码一次打完整包

下面是从全新克隆开始，一直到生成可执行 `npx` 安装包的完整顺序。该流程已在 Node.js `22.22.3`、pnpm `11.5.0`、npm `10.9.8` 下实际验证。

该流程默认 `Cursor++/package.json` 与 `installer/package.json` 的版本号一致；发布新版本时两边都要同步修改。

```bash
git clone https://github.com/island086/CCursor.git
cd CCursor

export CCURSOR_ROOT="$PWD"
export VERSION="$(node -p "require('./Cursor++/package.json').version")"

# 1. 安装 Cursor++ 扩展依赖
cd "$CCURSOR_ROOT/Cursor++"
CI=1 pnpm install \
  --frozen-lockfile \
  --ignore-scripts \
  --config.strict-dep-builds=false

# 2. 类型检查、Lint 和 Bidi 专项测试
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src
./node_modules/.bin/vitest run src/server/tests/bidiAppend.test.ts

# 3. 生产构建并生成 VSIX
node esbuild.js --production
./node_modules/.bin/vsce package \
  --no-dependencies \
  --allow-missing-repository \
  --skip-license \
  --allow-star-activation \
  --out "cursor2plus-${VERSION}-databinary.vsix"

# 4. 将 VSIX 放进安装器并生成 npm tgz
cd "$CCURSOR_ROOT/installer"
mkdir -p vsix
cp -f "../Cursor++/cursor2plus-${VERSION}-databinary.vsix" vsix/
npm ci
npm run build
npm pack --pack-destination .

# 5. 只读验证本地 npx 包
npx --yes "./cometix-ccursor-${VERSION}.tgz" status
```

最终产物：

```text
CCursor/Cursor++/cursor2plus-0.0.17-databinary.vsix
CCursor/installer/dist/cli.cjs
CCursor/installer/dist/models-catalog.json
CCursor/installer/cometix-ccursor-0.0.17.tgz
```

为什么 pnpm 安装命令要加两个参数：

- `--ignore-scripts`：不让依赖在安装阶段执行额外脚本。本项目的生产构建和 VSIX 打包已验证不依赖这些脚本。
- `--config.strict-dep-builds=false`：pnpm 11 默认会因 `@google/genai`、`@vscode/vsce-sign`、`keytar` 的构建脚本未批准而返回退出码 1；此参数让依赖安装正常结束，同时不会修改仓库中的 `pnpm-workspace.yaml`。

不要用 `pnpm run` 执行上述检查或打包脚本。pnpm 11 在执行 `pnpm run` 前可能再次触发依赖状态检查并失败；直接调用 `node_modules/.bin/` 下的工具最稳定。

全量测试可以另外执行：

```bash
./node_modules/.bin/vitest run
```

当前源码中已知 `protocol.test.ts` 有一个 `<user_rules>` 断言失败，结果是 `395/396`，与本 Bidi 修复和打包流程无关。

## 1. 概念区分

### 1.1 Cursor++ 扩展

实际运行逻辑在：

```text
Cursor++/src/
```

构建后的入口是：

```text
Cursor++/dist/extension.js
```

Cursor 通过 `Cursor++/package.json` 中的 `main` 字段加载它。

### 1.2 VSIX

VSIX 是 Cursor / VS Code 扩展安装包，本质上是一个 ZIP：

```text
extension/package.json
extension/dist/extension.js
extension/dist/webview.js
extension/resources/icon.png
```

VSIX 只包含扩展本身，不包含 Cursor 的本体修改。

### 1.3 Cursor++ 安装器

安装器是：

```text
installer/src/cli.js
```

安装器会：

1. 找到 Cursor.app
2. 解压 VSIX 到 `Cursor.app/Contents/Resources/app/extensions/cursor2plus/`
3. 注入 renderer hook
4. 修改 `cursor-always-local` 和 `cursor-agent-host`
5. 处理扩展签名校验、product checksum、路由代理等
6. 创建备份，支持卸载还原

用户平时执行的：

```bash
npx @cometix/ccursor install
npx @cometix/ccursor uninstall
npx @cometix/ccursor status
```

使用的就是安装器包。

## 2. 构建 Cursor++ 扩展

进入扩展目录：

```bash
cd "$CCURSOR_ROOT/Cursor++"
```

安装依赖：

```bash
CI=1 pnpm install \
  --frozen-lockfile \
  --ignore-scripts \
  --config.strict-dep-builds=false
```

如果不加后两个参数，pnpm 11 可能提示并因为未批准构建脚本而返回非 0：

```text
ERR_PNPM_IGNORED_BUILDS
Ignored build scripts: @google/genai, @vscode/vsce-sign, keytar
```

使用上面的参数后依赖安装会正常完成。后续检查和构建应直接调用 `node_modules/.bin/` 下的工具。

不要提交 pnpm 自动写入的占位内容，例如：

```yaml
'@google/genai': set this to true or false
```

`pnpm-workspace.yaml` 应保持项目原有配置。

### 2.1 类型检查

```bash
./node_modules/.bin/tsc --noEmit
```

### 2.2 运行测试

本次 Bidi 兼容测试：

```bash
./node_modules/.bin/vitest run src/server/tests/bidiAppend.test.ts
```

完整测试：

```bash
./node_modules/.bin/vitest run
```

> 当前上游存在一个与 Bidi 无关的 `protocol.test.ts` `<user_rules>` 断言失败。排查时应先确认是否属于已有问题。

### 2.3 生产构建

```bash
node esbuild.js --production
```

构建结果：

```text
Cursor++/dist/extension.js
Cursor++/dist/webview.js
Cursor++/dist/*.node
Cursor++/dist/o200k_base.js
```

`esbuild.js --production` 会执行压缩，并复制：

- supermarkdown 原生 `.node` 文件
- `gpt-tokenizer` 的 `o200k_base.js`

### 2.4 打包 VSIX

```bash
./node_modules/.bin/vsce package \
  --no-dependencies \
  --allow-missing-repository \
  --skip-license \
  --allow-star-activation \
  --out cursor2plus-0.0.17-databinary.vsix
```

产物：

```text
Cursor++/cursor2plus-0.0.17-databinary.vsix
```

`.vscodeignore` 会排除 `src/`、测试、构建脚本等内容，VSIX 中主要包含 `dist/`、`package.json`、图标和 README。

## 3. 只替换扩展、不重新跑安装器

如果当前机器已经安装过 Cursor++，路由补丁已经存在，只想更新扩展逻辑，可以只替换扩展入口：

```bash
cd "$CCURSOR_ROOT/Cursor++"

cp -p "$APP_ROOT/extensions/cursor2plus/dist/extension.js" \
  "$APP_ROOT/extensions/cursor2plus/dist/extension.js.backup"

cp -p dist/extension.js \
  "$APP_ROOT/extensions/cursor2plus/dist/extension.js"
```

然后重启 Cursor。

这种方式只更新 Cursor++ 扩展，不会重新注入或修改 Cursor 的路由 JS。

如果之前为了 Bidi 临时改过：

```text
extensions/cursor-always-local/dist/main.js
extensions/cursor-agent-host/dist/main.js
```

更新扩展后，应确认这两个文件恢复为原始逻辑：

```text
()=>!this.bidiAppendBinaryEncodingDisabled.isOn
```

而不是强制旧 hex 的：

```text
()=>!1
```

## 4. 构建 npx 安装器包

### 4.1 把扩展 VSIX 放进安装器

```bash
cd "$CCURSOR_ROOT/installer"

mkdir -p vsix
cp -f \
  "$CCURSOR_ROOT/Cursor++/cursor2plus-0.0.17-databinary.vsix" \
  vsix/
```

安装器会从 `vsix/` 目录中选择 `.vsix` 文件，并将其解压到 Cursor 的扩展目录。

### 4.2 安装安装器依赖

```bash
npm ci
```

### 4.3 构建安装器 CLI

```bash
npm run build
```

产物：

```text
installer/dist/cli.cjs
installer/dist/models-catalog.json
```

### 4.4 生成 npm tgz

```bash
npm pack --pack-destination .
```

会生成类似以下文件：

```text
installer/cometix-ccursor-0.0.17.tgz
```

包内包含：

```text
dist/cli.cjs
dist/models-catalog.json
vsix/cursor2plus-0.0.17-databinary.vsix
package.json
README.md
```

### 4.5 用本地 tgz 执行 npx

先做只读检查：

```bash
npx --yes ./cometix-ccursor-0.0.17.tgz status
```

新机器或已卸载环境：

```bash
npx --yes ./cometix-ccursor-0.0.17.tgz install
```

如果要完整重装当前机器：

```bash
npx --yes ./cometix-ccursor-0.0.17.tgz uninstall
npx --yes ./cometix-ccursor-0.0.17.tgz install
```

> 当前机器如果已经完整安装，直接执行 `install` 可能提示 `Already fully installed` 并跳过，不会自动替换扩展。

## 5. 官方等价脚本

`installer/package.json` 提供了：

```json
{
  "scripts": {
    "build": "node esbuild.js",
    "build:vsix": "node src/build-vsix.js",
    "build:all": "npm run build:vsix && npm run build"
  }
}
```

理论上可以执行：

```bash
cd "$CCURSOR_ROOT/installer"
npm run build:all
npm pack --pack-destination .
```

但 `build:vsix` 内部会调用 Cursor++ 项目的：

```bash
pnpm run vsix
```

在当前 pnpm 环境下，可能再次触发 `ERR_PNPM_IGNORED_BUILDS`。因此本文采用更可控的手动流程：

1. 在 `Cursor++/` 生成 VSIX
2. 复制到 `installer/vsix/`
3. 在 `installer/` 执行 `npm run build`
4. 执行 `npm pack`

## 6. 发布成自己的 npm 包（npx）

`npx` 不是把 tgz 推到 GitHub，而是先把安装器发布到 npm registry，之后 `npx` 才能按包名下载并执行。

公开的：

```bash
npx @cometix/ccursor install
```

始终从 npm 下载官方包，不会使用本地构建的 tgz。官方包 `@cometix/ccursor` 已经存在，当前最新版本是 `0.0.17`，没有该 npm 组织权限时不能覆盖。请使用自己的 scope 和新版本。

### 6.1 登录 npm

```bash
npm login
npm whoami
```

`npm whoami` 必须输出自己的 npm 用户名。如果报 `ENEEDAUTH`，说明还没有登录。

### 6.2 修改包名和版本

假设 npm 用户名是 `alice`，发布一个公开的 `@alice/ccursor` 包：

```bash
cd "$CCURSOR_ROOT/Cursor++"
npm pkg set version=0.0.18

cd "$CCURSOR_ROOT/installer"
npm pkg set name=@alice/ccursor
npm pkg set version=0.0.18
npm install --package-lock-only --ignore-scripts
```

注意事项：

- scope 必须是自己的 npm 用户名或自己拥有的组织名。
- `Cursor++/package.json` 和 `installer/package.json` 的版本应保持一致。
- npm 版本号不可覆盖；每次重新发布都必须增加版本号。
- 可以用 `npm view @alice/ccursor version` 检查包名和版本；返回 `E404` 通常表示该包尚未发布。

### 6.3 重新构建并检查包内容

版本修改后，重新执行本文第 `0.1` 节的完整构建流程，然后检查 npm 将上传的文件：

```bash
cd "$CCURSOR_ROOT/installer"
npm publish --dry-run --access public
```

输出中应包含：

```text
dist/cli.cjs
dist/models-catalog.json
vsix/cursor2plus-0.0.18-databinary.vsix
package.json
README.md
```

### 6.4 发布到 npm

```bash
cd "$CCURSOR_ROOT/installer"
npm publish --access public
```

如果 npm 账号启用了双因素认证，按提示输入验证码，或使用：

```bash
npm publish --access public --otp=123456
```

首次发布带 scope 的包时必须带 `--access public`，否则 npm 会默认按私有包处理，普通用户无法通过 `npx` 下载。

### 6.5 验证远程 npx

先执行只读检查：

```bash
npm view @alice/ccursor@0.0.18 version
npx --yes @alice/ccursor@0.0.18 status
```

确认无误后再安装：

```bash
npx --yes @alice/ccursor@0.0.18 install
```

后续发布新版本：

```bash
npx --yes @alice/ccursor@latest status
```

常见错误：

- `ENEEDAUTH`：没有执行 `npm login`。
- `E403`：没有该 scope 的权限，或者该版本已经存在。
- `E404`：包名不存在、scope 不属于当前账号，或者当前账号无权访问。
- `You cannot publish over the previously published versions`：版本号没有增加。

没有 npm 发布权限时，不要尝试覆盖官方的 `@cometix/ccursor`；本地测试直接使用 `.tgz` 即可。

## 7. BidiAppend 兼容逻辑

核心代码：

```text
Cursor++/src/server/services/core/BidiService.ts
```

兼容顺序：

1. `dataBinary` 是 `Uint8Array`：新版 raw protobuf bytes
2. `dataBinary` 是字符串：JSON 路径下的 base64
3. `dataBinary` 为空：回退到旧版 `data`
4. 旧版 `data`：hex
5. 两个字段都有值：优先 `dataBinary`

测试文件：

```text
Cursor++/src/server/tests/bidiAppend.test.ts
```

正常日志应包含：

```text
[SVC] BidiAppend ... "encoding":"binary"
[SESSION] appendMessage ... "keys":["runRequest"]
[SVC] RunSSE first message
```

如果出现：

```text
[SVC] BidiAppend missing fields
```

说明请求里既没有可用的 `data`，也没有可用的 `dataBinary`。

## 8. 常见问题

### `ERR_PNPM_IGNORED_BUILDS`

先确认 `node_modules` 是否已经安装。如果已经安装，可以直接使用：

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
./node_modules/.bin/vsce package ...
```

不要把 pnpm 自动生成的占位配置提交到仓库。

### `npx @cometix/ccursor` 没有使用本地代码

这是正常的。`npx` 默认从 npm registry 下载官方包。

使用本地包：

```bash
npx --yes ./cometix-ccursor-0.0.17.tgz status
```

或者发布自己的 npm 包。

### 安装器提示 `Already fully installed`

安装器检测到扩展和路由补丁都已存在时会直接跳过。需要完整重装时：

```bash
npx --yes ./cometix-ccursor-0.0.17.tgz uninstall
npx --yes ./cometix-ccursor-0.0.17.tgz install
```

### 只想更新扩展，不想动 Cursor JS

直接替换：

```text
Cursor.app/Contents/Resources/app/extensions/cursor2plus/dist/extension.js
```

然后重启 Cursor。不要运行安装器的 `install`，除非确实需要重新注入路由补丁。

## 9. 不建议提交的构建产物

以下内容通常只用于本机构建，不应提交：

```text
Cursor++/node_modules/
Cursor++/dist/
Cursor++/*.vsix
installer/node_modules/
installer/dist/
installer/vsix/
installer/*.tgz
```

源码、测试和本文档应提交；构建产物应按需要单独发布到 npm 或作为本地文件保存。
