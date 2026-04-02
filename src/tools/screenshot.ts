import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScreenshotInput {
  save_to_vault?: boolean;  // optionally save to Inbox as well
}

export interface ScreenshotOutput {
  success: boolean;
  message: string;
  file_path?: string;
}

export async function takeScreenshot(input: ScreenshotInput = {}): Promise<{ output: ScreenshotOutput; imageData: string; mimeType: string }> {
  // Use Windows/Temp via /mnt/c for both script and output — avoids UNC paths entirely
  const ts = Date.now();
  const linuxTmpPath = `/mnt/c/Windows/Temp/screenshot-${ts}.png`;
  const winTmpPath = `C:\\Windows\\Temp\\screenshot-${ts}.png`;
  const psScriptLinux = `/mnt/c/Windows/Temp/ss-${ts}.ps1`;
  const winScriptPath = `C:\\Windows\\Temp\\ss-${ts}.ps1`;

  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$screen = [System.Windows.Forms.Screen]::PrimaryScreen',
    `$bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)`,
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)',
    `$bmp.Save('${winTmpPath}')`,
    '$g.Dispose()',
    '$bmp.Dispose()',
  ].join('\n');

  fs.writeFileSync(psScriptLinux, psScript);

  execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${winScriptPath}"`, { timeout: 10000 });

  fs.unlinkSync(psScriptLinux);

  if (!fs.existsSync(linuxTmpPath)) {
    throw new Error('Screenshot file not created');
  }

  const imageBuffer = fs.readFileSync(linuxTmpPath);
  const imageData = imageBuffer.toString('base64');

  let savedPath: string | undefined;

  if (input.save_to_vault) {
    const { resolvePath, ensureDir } = await import('../utils/vault_ops');
    const vaultFile = resolvePath('Inbox', `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    ensureDir(path.dirname(vaultFile));
    fs.copyFileSync(linuxTmpPath, vaultFile);
    savedPath = vaultFile;
  }

  fs.unlinkSync(linuxTmpPath);

  return {
    output: {
      success: true,
      message: savedPath ? `Screenshot taken and saved to vault: ${savedPath}` : 'Screenshot taken',
      file_path: savedPath,
    },
    imageData,
    mimeType: 'image/png',
  };
}
