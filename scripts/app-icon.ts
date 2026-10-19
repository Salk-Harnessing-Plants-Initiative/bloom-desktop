/**
 * App icon paths and Windows name settings for forge.config.ts.
 *
 * The icons are built from assets/icons/icon.svg by scripts/build-icons.sh.
 * electron-packager adds the platform's extension to APP_ICON_BASE (.ico on
 * Windows, .icns on macOS).
 */
export const APP_ICON_BASE = 'assets/icons/icon';
export const WINDOWS_ICON = `${APP_ICON_BASE}.ico`;
export const LINUX_ICON = `${APP_ICON_BASE}.png`;

/**
 * Windows shows FileDescription in Task Manager and some hover tooltips. By
 * default it comes from package.json's long `description`, so set it to the
 * product name.
 */
export function windowsMetadata(productName: string): {
  ProductName: string;
  FileDescription: string;
} {
  return { ProductName: productName, FileDescription: productName };
}
