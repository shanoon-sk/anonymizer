// electron-builder afterPack hook: keep only the onnxruntime-node binary for the target platform/arch.
const { readdirSync, rmSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { Arch } = require('electron-builder')

exports.default = async function afterPack(ctx) {
  const platform = ctx.electronPlatformName // darwin | win32 | linux
  const arch = Arch[ctx.arch] // x64 | arm64 | ...
  const resources =
    platform === 'darwin'
      ? join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(ctx.appOutDir, 'resources')
  const bin = join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin')
  if (!existsSync(bin)) throw new Error(`onnxruntime-node binaries not found in ${bin}`)
  for (const napi of readdirSync(bin)) {
    for (const plat of readdirSync(join(bin, napi))) {
      if (plat !== platform) {
        rmSync(join(bin, napi, plat), { recursive: true, force: true })
        continue
      }
      for (const a of readdirSync(join(bin, napi, plat))) {
        if (a !== arch) rmSync(join(bin, napi, plat, a), { recursive: true, force: true })
      }
    }
  }
  // Native image binaries for other platforms (present when cross-building)
  const img = join(resources, 'app.asar.unpacked', 'node_modules', '@img')
  if (existsSync(img)) {
    for (const d of readdirSync(img)) {
      const m = /^sharp-(?:libvips-)?([a-z0-9]+)-([a-z0-9]+)$/.exec(d)
      if (m && (m[1] !== platform || m[2] !== arch)) rmSync(join(img, d), { recursive: true, force: true })
    }
  }
}
