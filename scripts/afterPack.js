// electron-builder afterPack 钩子：对 macOS 产物做 ad-hoc 签名。
//
// 没有 Apple 开发者账号时 build.mac.identity 设为 null，electron-builder 会完全
// 跳过签名，于是 .app 保留着 Electron 二进制自带、但内容已被改动而失效的签名，
// `codesign --verify --deep --strict` 会报
//   "code has no resources but signature indicates they must be present"。
// 应用本身仍能在本机启动，但签名无效会让 Gatekeeper 更严格地对待下载来的包。
// ad-hoc 签名（-）不需要任何证书，能让签名重新自洽。
//
// 注意：ad-hoc 签名每次构建都会变，而 macOS 的 Keychain 条目和代码签名绑定 ——
// 升级版本后用户可能需要重新授权 Keychain 或重新配置密钥。

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`  • ad-hoc signing  ${appName} (${context.arch === 1 ? 'x64' : 'arm64'})`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });
};
