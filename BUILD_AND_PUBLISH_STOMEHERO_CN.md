# @stomehero/ccursor 从 0 构建、打包与发布

本文对应当前 fork 的 npm 包：

```text
包名：@stomehero/ccursor
版本：0.0.17-fix
入口：dist/cli.cjs
命令：ccursor
```

最终发到 npm 后可通过以下命令使用：

```bash
npx @stomehero/ccursor@0.0.17-fix status
npx @stomehero/ccursor@0.0.17-fix install
```

## 0. 先区分 GitHub 和 npm

以下操作只把源码和文档推到 GitHub：

```bash
git push island086 main:main
```

以下操作才会把安装器发布到 npm：

```bash
npm publish --access public --tag latest
```

`npx` 默认从 npm registry 下载包，不会读取 GitHub 仓库。

## 1. 环境准备

本文已在以下环境验证：

```text
macOS
Node.js 22.22.3
npm 10.9.8
pnpm 11.5.0
Cursor
```

检查工具：

```bash
node --version
npm --version
pnpm --version
```

## 2. 从 GitHub 全新克隆

```bash
git clone https://github.com/island086/CCursor.git
cd CCursor

export CCURSOR_ROOT="$PWD"
export VERSION="$(node -p "require('./Cursor++/package.json').version")"
export PACKAGE_NAME="@stomehero/ccursor"
```

当前版本应输出：

```bash
echo "$VERSION"
```

```text
0.0.17-fix
```

## 3. 登录 npm

`npmjs.com` 网页登录和终端登录是两件事。必须在终端确认：

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

第二条命令应输出：

```text
stomehero
```

发布前检查包名：

```bash
npm view "$PACKAGE_NAME" version \
  --registry=https://registry.npmjs.org/
```

首次发布时返回 `E404 Not Found` 是正常的，表示这个包名还没有发布过。

## 4. 安装 Cursor++ 扩展依赖

```bash
cd "$CCURSOR_ROOT/Cursor++"

CI=1 pnpm install \
  --frozen-lockfile \
  --ignore-scripts \
  --config.strict-dep-builds=false
```

必须带最后两个参数：

- pnpm 11 默认会因为未批准的依赖构建脚本返回退出码 1。
- 本项目已验证不执行这些依赖脚本也能完成构建。
- 直接调用 `node_modules/.bin/` 工具，避免 `pnpm run` 再次触发依赖检查。

## 5. 类型检查、Lint 和测试

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src
./node_modules/.bin/vitest run src/server/tests/bidiAppend.test.ts
```

Bidi 专项测试应为：

```text
5 passed
```

可选全量测试：

```bash
./node_modules/.bin/vitest run
```

当前上游已知 `protocol.test.ts` 有一个 `<user_rules>` 断言失败，结果为：

```text
395 passed, 1 failed
```

该失败与本 fork 的 Bidi 修复和打包流程无关。

## 6. 构建扩展并生成 VSIX

```bash
cd "$CCURSOR_ROOT/Cursor++"

node esbuild.js --production

./node_modules/.bin/vsce package \
  --no-dependencies \
  --allow-missing-repository \
  --skip-license \
  --allow-star-activation \
  --out "cursor2plus-${VERSION}-databinary.vsix"
```

产物：

```text
Cursor++/cursor2plus-0.0.17-fix-databinary.vsix
```

`0.0.17-fix` 是合法的 SemVer 预发布版本，`vsce` 不需要额外加 `--pre-release` 参数。

## 7. 构建 npm 安装器

先清理安装器目录中可能残留的旧 VSIX，避免 npm 包同时包含多个版本：

```bash
cd "$CCURSOR_ROOT/installer"

mkdir -p vsix
find vsix -maxdepth 1 -type f -name '*.vsix' -delete

cp -f \
  "../Cursor++/cursor2plus-${VERSION}-databinary.vsix" \
  vsix/
```

确认 `vsix/` 只有一个文件：

```bash
find vsix -maxdepth 1 -type f -print
```

安装依赖并构建：

```bash
npm ci
npm run build
```

构建结果：

```text
installer/dist/cli.cjs
installer/dist/models-catalog.json
```

## 8. 生成 npm tgz

```bash
cd "$CCURSOR_ROOT/installer"
npm pack --pack-destination .
```

产物：

```text
installer/stomehero-ccursor-0.0.17-fix.tgz
```

检查 tgz 内容：

```bash
tar -tzf "stomehero-ccursor-0.0.17-fix.tgz"
tar -xOf "stomehero-ccursor-0.0.17-fix.tgz" package/package.json
```

正确内容应只有五个文件：

```text
package/package.json
package/README.md
package/dist/cli.cjs
package/dist/models-catalog.json
package/vsix/cursor2plus-0.0.17-fix-databinary.vsix
```

如果出现两个 VSIX，不要发布；回到第 7 步清理旧的 `installer/vsix/*.vsix` 后重新执行 `npm pack`。

## 9. 本地 npx 验证

直接执行本地 tgz：

```bash
npx --yes ./stomehero-ccursor-0.0.17-fix.tgz status
```

应能看到：

```text
Cursor: /Applications/Cursor.app/Contents/Resources/app
✓ Extension installed
✓ Renderer hook injected (desktop)
✓ Renderer hook injected (glass)
```

这一步只读取安装状态，不会修改 Cursor。

## 10. 发布前 dry-run

```bash
cd "$CCURSOR_ROOT/installer"

npm publish \
  --dry-run \
  --access public \
  --tag latest \
  --registry=https://registry.npmjs.org/
```

输出必须包含：

```text
name: @stomehero/ccursor
version: 0.0.17-fix
filename: stomehero-ccursor-0.0.17-fix.tgz
vsix/cursor2plus-0.0.17-fix-databinary.vsix
total files: 5
```

这里是 `0.0.17-fix` 预发布版本，但它是当前 fork 的唯一发布版本，所以使用 `--tag latest`，确保下面的命令可以直接运行：

```bash
npx @stomehero/ccursor
```

## 11. 正式发布到 npm

确认 dry-run 无误后执行：

```bash
cd "$CCURSOR_ROOT/installer"

npm publish \
  --access public \
  --tag latest \
  --registry=https://registry.npmjs.org/
```

如果 npm 开启了双因素认证，按提示输入验证码，或者：

```bash
npm publish \
  --access public \
  --tag latest \
  --otp=你的六位验证码 \
  --registry=https://registry.npmjs.org/
```

发布完成后检查：

```bash
npm view @stomehero/ccursor version --registry=https://registry.npmjs.org/
npm view @stomehero/ccursor dist-tags --registry=https://registry.npmjs.org/
```

预期：

```text
0.0.17-fix

{
  "latest": "0.0.17-fix"
}
```

## 12. 验证远程 npx

先执行只读检查：

```bash
npx --yes @stomehero/ccursor@0.0.17-fix status
```

再验证 `latest`：

```bash
npx --yes @stomehero/ccursor@latest status
```

最后安装：

```bash
npx --yes @stomehero/ccursor@0.0.17-fix install
```

卸载：

```bash
npx --yes @stomehero/ccursor@0.0.17-fix uninstall
```

## 13. 后续发布新版本

npm 的 `包名@版本` 发布后不能覆盖。下次发布前必须同时修改：

```text
Cursor++/package.json
installer/package.json
```

例如两个文件都改成：

```json
{
  "version": "0.0.17-fix.1"
}
```

然后同步锁文件：

```bash
cd "$CCURSOR_ROOT/installer"
npm install --package-lock-only --ignore-scripts
```

最后从本文第 4 步开始重新构建、重新 `npm pack`、重新发布。不要复用旧的 VSIX 或旧 tgz。

## 14. 不应该提交到 Git 的内容

```text
Cursor++/node_modules/
Cursor++/dist/
Cursor++/*.vsix
installer/node_modules/
installer/dist/
installer/vsix/
installer/*.tgz
```

源码、`package.json`、`package-lock.json`、测试和文档应提交；构建产物用于本地测试或发布到 npm。

## 15. 常见错误

### ENEEDAUTH

终端没有登录 npm：

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

### E403

通常有三种原因：

- 当前账号没有该 scope 的权限。
- 该 `包名@版本` 已经发布过。
- npm 要求双因素认证但没有提供 OTP。

### E404

`npm view` 返回 `E404` 只表示包或版本不存在。首次发布自己的新包时，这是正常现象。

### ERR_PNPM_IGNORED_BUILDS

使用本文的安装命令：

```bash
CI=1 pnpm install \
  --frozen-lockfile \
  --ignore-scripts \
  --config.strict-dep-builds=false
```

不要执行 `pnpm run vsix`，直接调用：

```bash
node esbuild.js --production
./node_modules/.bin/vsce package ...
```

### npm 包里出现两个 VSIX

说明 `installer/vsix/` 有旧文件。清理后重新打包：

```bash
find vsix -maxdepth 1 -type f -name '*.vsix' -delete
cp -f "../Cursor++/cursor2plus-${VERSION}-databinary.vsix" vsix/
npm pack --pack-destination .
```
