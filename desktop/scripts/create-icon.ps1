param([Parameter(Mandatory = $true)][string]$OutputPath)

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(39, 112, 218))
$font = New-Object System.Drawing.Font 'Microsoft YaHei UI', 142, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
try {
    # 桌面图标沿用西米露名称与蓝白配色，不使用运行时默认图标。
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.FillEllipse($brush, 4, 4, 248, 248)
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString([string][char]0x897F, $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, 0, 256, 246), $format)
    $bitmap.Save([System.IO.Path]::GetFullPath($OutputPath), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $format.Dispose()
    $font.Dispose()
    $brush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
