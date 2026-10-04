/* Sets the ULTRALINK icon + version info on the Windows exe without wine/rcedit (pure JS, works on any build host). */
const fs = require('fs'), path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const ver = ctx.packager.appInfo.version;
  const exeObj = PE.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exeObj);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const ids = groups.length ? groups.map(g => g.id) : [1];
  for (const id of ids) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, 1033, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = ver.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'ULTRALINK', ProductName: 'ULTRALINK', CompanyName: 'ULTRALINK',
    LegalCopyright: 'ULTRALINK', OriginalFilename: 'ULTRALINK.exe', InternalName: 'ULTRALINK',
    FileVersion: ver, ProductVersion: ver
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
  console.log('  • ULTRALINK icon + version info set on', path.basename(exe));
};
