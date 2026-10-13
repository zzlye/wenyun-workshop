export function createUninstallInclude(entries) {
  const lines = [
    '; 升级和卸载只删除安装包中的程序文件，保留输出目录与用户放入的其他文件。',
    '!macro customRemoveFiles',
    '  SetOutPath "$TEMP"',
  ];
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name) || ['.', '..', '输出'].includes(entry.name)) throw new Error('安装文件名称无效');
    if (entry.name === 'electron.exe') continue;
    // 只有内置的两个资源目录允许递归删除，不能扩大到整个安装目录。
    if (entry.directory && !['locales', 'resources'].includes(entry.name)) throw new Error('安装资源目录未登记');
    lines.push(`  ${entry.directory ? 'RMDir /r' : 'Delete'} "$INSTDIR\\${entry.name}"`);
  }
  lines.push(
    '  Delete "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"',
    '  Delete "$INSTDIR\\${UNINSTALL_FILENAME}"',
    '  Delete "$INSTDIR\\uninstallerIcon.ico"',
    '  RMDir "$INSTDIR"',
    '!macroend',
  );
  return `${lines.join('\n')}\n`;
}
