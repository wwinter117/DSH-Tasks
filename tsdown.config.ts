/**
 * Self-contained build for a dual-face DSH plugin bundle.
 *
 * The DSH repository emits its client halves with `packages/client/tsdown.client.ts`.
 * That preset is not published as a package, so a plugin living outside the repository
 * reproduces the artifact contract itself. The contract is small:
 *
 * 1. The browser half must register itself with the page module loader in the
 *    lazy-CJS factory form
 *
 *      window.__ModuleLoader__.load({ id: "<package>", factory: (require) => { ... } })
 *
 *    resolving the shell's shared module table through the injected `require`.
 * 2. Every specifier in that table stays external; everything else is inlined as a
 *    private copy.
 * 3. An imported CSS Module yields its hashed class map plus one tagged `<style>`
 *    element carrying `data-plugin` / `data-plugin-css`, which is what the client
 *    module system's style bookkeeping claims during materialization.
 *
 * The host half is an ordinary ESM bundle: the profile Loader imports it directly.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { TsdownPlugin, UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The plugin id stamped into the module-loader handoff and onto injected style tags. */
const PACKAGE = 'dsh-tasks'

/**
 * The shell's shared module table (`PLATFORM_MODULES` in the DSH checkout at
 * `packages/client/web/src/platform.ts`). These specifiers resolve through the loader
 * `require`; every one of them must stay external or the browser loads a second React.
 *
 * Keep this list equal to the upstream constant when the DSH runtime is upgraded.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

const CSS_VIRTUAL_PREFIX = '\0dsh-tasks-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Emit one plugin-owned style injector and, for a CSS Module, its class-map export.
 * @param id - plugin id stamped onto the injected tag.
 * @param fileId - absolute stylesheet path, used to make the tag id stable across rebuilds.
 * @param css - compiled stylesheet text.
 * @param classMap - hashed class names, or `undefined` for a global sheet.
 * @returns the module source replacing the stylesheet import.
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/**
 * Rewrite `.module.css` imports into a class map plus a tagged style injection.
 *
 * The virtual id deliberately does not end in `.css`: tsdown's own stylesheet guard
 * matches on that suffix and would claim the module before this loader sees it.
 * @returns the rolldown plugin.
 */
function cssModulesPlugin(): TsdownPlugin {
  return {
    name: 'dsh-tasks-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const entries = Object.entries(cssExports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exported] of entries) classMap[local] = exported.name
      return styleInjectionModule(PACKAGE, fileId, code.toString(), classMap)
    },
  }
}

/**
 * Rewrite a plain `.css` import into a tagged style injection with no class map.
 * @returns the rolldown plugin.
 */
function globalCssPlugin(): TsdownPlugin {
  return {
    name: 'dsh-tasks-css-global',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return styleInjectionModule(PACKAGE, fileId, code.toString())
    },
  }
}

/** Host half: the ESM module the profile Loader imports. */
const host: UserConfig = {
  name: PACKAGE,
  entry: { index: 'src/index.ts' },
  tsconfig: 'tsconfig.host.json',
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  external: ['zod'],
  dts: false,
  sourcemap: true,
  clean: false,
  // The package is `"type": "module"`, so the emitted `.js` is already ESM. The
  // Loader resolves this file through the `main`/`exports` fields, which name it.
  outputOptions: { entryFileNames: 'index.js' },
}

/** Client half: the lazy-CJS factory the browser module loader materializes. */
const client: UserConfig = {
  name: `${PACKAGE}/client`,
  entry: { client: 'src/client/index.ts' },
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  external: [...PLATFORM_MODULES],
  dts: false,
  sourcemap: true,
  clean: false,
  plugins: [cssModulesPlugin(), globalCssPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [host, client]
