type IconifyIcon = unknown;
import defaultFileIcon from "@iconify/icons-vscode-icons/default-file";
import defaultFolderIcon from "@iconify/icons-vscode-icons/default-folder";
import defaultFolderOpenedIcon from "@iconify/icons-vscode-icons/default-folder-opened";
import fileTypeAudioIcon from "@iconify/icons-vscode-icons/file-type-audio";
import fileTypeConfigIcon from "@iconify/icons-vscode-icons/file-type-config";
import fileTypeCssIcon from "@iconify/icons-vscode-icons/file-type-css";
import fileTypeDockerIcon from "@iconify/icons-vscode-icons/file-type-docker";
import fileTypeEslintIcon from "@iconify/icons-vscode-icons/file-type-eslint";
import fileTypeFontIcon from "@iconify/icons-vscode-icons/file-type-font";
import fileTypeGitIcon from "@iconify/icons-vscode-icons/file-type-git";
import fileTypeHtmlIcon from "@iconify/icons-vscode-icons/file-type-html";
import fileTypeImageIcon from "@iconify/icons-vscode-icons/file-type-image";
import fileTypeJsIcon from "@iconify/icons-vscode-icons/file-type-js";
import fileTypeJsonIcon from "@iconify/icons-vscode-icons/file-type-json";
import fileTypeLessIcon from "@iconify/icons-vscode-icons/file-type-less";
import fileTypeLicenseIcon from "@iconify/icons-vscode-icons/file-type-license";
import fileTypeMarkdownIcon from "@iconify/icons-vscode-icons/file-type-markdown";
import fileTypeNpmIcon from "@iconify/icons-vscode-icons/file-type-npm";
import fileTypePdfIcon from "@iconify/icons-vscode-icons/file-type-pdf2";
import fileTypePnpmIcon from "@iconify/icons-vscode-icons/file-type-pnpm";
import fileTypePostcssIcon from "@iconify/icons-vscode-icons/file-type-postcss";
import fileTypePowershellIcon from "@iconify/icons-vscode-icons/file-type-powershell";
import fileTypePrettierIcon from "@iconify/icons-vscode-icons/file-type-prettier";
import fileTypePythonIcon from "@iconify/icons-vscode-icons/file-type-python";
import fileTypeSassIcon from "@iconify/icons-vscode-icons/file-type-sass";
import fileTypeScssIcon from "@iconify/icons-vscode-icons/file-type-scss";
import fileTypeShellIcon from "@iconify/icons-vscode-icons/file-type-shell";
import fileTypeTailwindIcon from "@iconify/icons-vscode-icons/file-type-tailwind";
import fileTypeTextIcon from "@iconify/icons-vscode-icons/file-type-text";
import fileTypeTomlIcon from "@iconify/icons-vscode-icons/file-type-toml";
import fileTypeTypescriptIcon from "@iconify/icons-vscode-icons/file-type-typescript";
import fileTypeTypescriptDefIcon from "@iconify/icons-vscode-icons/file-type-typescriptdef";
import fileTypeVideoIcon from "@iconify/icons-vscode-icons/file-type-video";
import fileTypeViteIcon from "@iconify/icons-vscode-icons/file-type-vite";
import fileTypeVueIcon from "@iconify/icons-vscode-icons/file-type-vue";
import fileTypeXmlIcon from "@iconify/icons-vscode-icons/file-type-xml";
import fileTypeYamlIcon from "@iconify/icons-vscode-icons/file-type-yaml";
import fileTypeZipIcon from "@iconify/icons-vscode-icons/file-type-zip";

const FILE_NAME_ICONS: Record<string, IconifyIcon> = {
  ".dockerignore": fileTypeDockerIcon,
  ".editorconfig": fileTypeConfigIcon,
  ".env": fileTypeConfigIcon,
  ".eslintrc": fileTypeEslintIcon,
  ".gitignore": fileTypeGitIcon,
  ".prettierrc": fileTypePrettierIcon,
  dockerfile: fileTypeDockerIcon,
  "eslint.config.js": fileTypeEslintIcon,
  "eslint.config.mjs": fileTypeEslintIcon,
  license: fileTypeLicenseIcon,
  "package.json": fileTypeNpmIcon,
  "pnpm-lock.yaml": fileTypePnpmIcon,
  "postcss.config.cjs": fileTypePostcssIcon,
  "postcss.config.js": fileTypePostcssIcon,
  "prettier.config.cjs": fileTypePrettierIcon,
  "prettier.config.js": fileTypePrettierIcon,
  "tailwind.config.cjs": fileTypeTailwindIcon,
  "tailwind.config.js": fileTypeTailwindIcon,
  "tailwind.config.ts": fileTypeTailwindIcon,
  "vite.config.js": fileTypeViteIcon,
  "vite.config.mjs": fileTypeViteIcon,
  "vite.config.ts": fileTypeViteIcon,
};

const EXTENSION_ICONS: Record<string, IconifyIcon> = {
  bmp: fileTypeImageIcon,
  cjs: fileTypeJsIcon,
  css: fileTypeCssIcon,
  gif: fileTypeImageIcon,
  html: fileTypeHtmlIcon,
  ico: fileTypeImageIcon,
  jpeg: fileTypeImageIcon,
  jpg: fileTypeImageIcon,
  js: fileTypeJsIcon,
  json: fileTypeJsonIcon,
  jsx: fileTypeJsIcon,
  less: fileTypeLessIcon,
  log: fileTypeTextIcon,
  mjs: fileTypeJsIcon,
  md: fileTypeMarkdownIcon,
  mp3: fileTypeAudioIcon,
  mp4: fileTypeVideoIcon,
  ogg: fileTypeAudioIcon,
  otf: fileTypeFontIcon,
  pdf: fileTypePdfIcon,
  png: fileTypeImageIcon,
  ps1: fileTypePowershellIcon,
  py: fileTypePythonIcon,
  sass: fileTypeSassIcon,
  scss: fileTypeScssIcon,
  sh: fileTypeShellIcon,
  svg: fileTypeImageIcon,
  toml: fileTypeTomlIcon,
  ts: fileTypeTypescriptIcon,
  tsx: fileTypeTypescriptIcon,
  ttf: fileTypeFontIcon,
  txt: fileTypeTextIcon,
  vue: fileTypeVueIcon,
  wav: fileTypeAudioIcon,
  webp: fileTypeImageIcon,
  xml: fileTypeXmlIcon,
  yaml: fileTypeYamlIcon,
  yml: fileTypeYamlIcon,
  zip: fileTypeZipIcon,
};

function basenameFromAnyPath(pathValue: string): string {
  const segments = String(pathValue ?? "").split(/[\\/]+/);
  return segments[segments.length - 1] ?? "";
}

function resolveVscodeFileIcon(pathValue: string): IconifyIcon {
  const fileName = basenameFromAnyPath(pathValue).trim().toLowerCase();
  if (!fileName) return defaultFileIcon;
  const byName = FILE_NAME_ICONS[fileName];
  if (byName) return byName;
  if (fileName.endsWith(".d.ts")) return fileTypeTypescriptDefIcon;
  const extension = fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "";
  return EXTENSION_ICONS[extension] ?? defaultFileIcon;
}

export function resolveVscodeEntryIcon(
  pathValue: string,
  options: { isDirectory: boolean; isExpanded?: boolean }
): IconifyIcon {
  if (options.isDirectory) return options.isExpanded ? defaultFolderOpenedIcon : defaultFolderIcon;
  return resolveVscodeFileIcon(pathValue);
}
