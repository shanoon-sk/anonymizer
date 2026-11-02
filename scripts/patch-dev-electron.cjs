// macOS dev only: the bold app name next to the Apple menu (and the Dock label/icon) comes from the
// Electron binary's Info.plist, not from app code. Rename the local dev Electron so `npm run dev`
// shows "Anonymo". Packaged builds get the right name from electron-builder anyway.
const { execFileSync } = require('node:child_process')
const { copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform !== 'darwin') process.exit(0)
const NAME = 'Anonymo'
const app = join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = join(app, 'Contents', 'Info.plist')
if (!existsSync(plist)) process.exit(0)

const set = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, plist])
set('CFBundleName', NAME)
set('CFBundleDisplayName', NAME)

// Dock icon: convert the brand PNG to .icns if possible (sips + iconutil ship with macOS)
const png = join(__dirname, '..', 'build', 'icon.png')
if (existsSync(png)) {
  try {
    const tmp = join(require('node:os').tmpdir(), 'anon-icon.iconset')
    execFileSync('rm', ['-rf', tmp])
    execFileSync('mkdir', ['-p', tmp])
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), png, '--out', join(tmp, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(tmp, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
    }
    const icns = join(require('node:os').tmpdir(), 'anon-icon.icns')
    execFileSync('iconutil', ['-c', 'icns', tmp, '-o', icns])
    copyFileSync(icns, join(app, 'Contents', 'Resources', 'electron.icns'))
  } catch {
    /* icon is cosmetic – ignore */
  }
}
// Make Launch Services pick up the change
execFileSync('touch', [app])
console.log(`✓ dev Electron renamed to "${NAME}"`)
