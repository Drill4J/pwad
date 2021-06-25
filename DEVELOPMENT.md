# PWAD - Development reference

## Dev & Debug

1. Install development dependencies

   ```shell
     rm -rf node_modules
     npm i
   ```

2. Set `"sourceMap": true,` in tsconfig.json

3. Run webpack development server

   ```shell
     npm run dev
   ```

4. Attach debugger to the process started with `npm run dev`

   > VScode:

   - Run `Debug on fixtures` launch configuration
   - Edit configuration to debug on different files

   > Other IDEs:

   - Attach debugger of your choice to the running process, use .vscode/launch.json `Debug on fixtures` configuration as the example

## Production build

1. Set `"sourceMap": false,` in tsconfig.json

   > TODO: add separate build config

2. Run

```shell
    npm install && set NODE_ENV=production&& npx webpack --config webpack.config.js && rm -rf node_modules && npm i --only=prod && npm prune --production
```

## Pack executable

1. Perform production build (see previous section)

2. Open `node_modules/flatted/package.json`. Remove the following lines

```json
   "module": "./esm/index.js",
   ...
   "type": "module",
```

3. Run to make a build for all supported platforms

```shell
  pkg ./dist/index.js
```

4. Or specify a target, e.g. build for Node14 Windows x64

```shell
   pkg -t node14-win-x64 ./dist/index.js
```

> Pkg will not resolve dynamic module imports, so avoid these at all costs. (Basically, just use plain ordinary static `import Something from 'somewhere'` and no issue should arise)

> TODO: add `flatted/package.json` patch into npm post-install script

**Q**: Why removing these lines from `flatted/package.json?`

**A**: Pkg is unable to "understand" that when modules is imported with `require()`, it has to utilize `"main": "./cjs/index.js",` to locate CJS module, instead of using `"module": "./esm/index.js"` field to locate ESM module. `"type": "module"` makes it stumble. Removing it from package.json solves the issue

**Q**: But why not use Babel?!

**A**: Yes, we could use Babel to transpile all dependencies, but that's too much hassle, when the fix is so simple
