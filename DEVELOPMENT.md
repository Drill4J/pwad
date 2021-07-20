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

3. Run to make a build for all supported platforms (configure with `"pkg"` field in [package.json](./package.json))

```shell
  pkg .
```

4. Or specify a target, e.g. build for Node14 Windows x64

```shell
   pkg . -t node14-win-x64 ./dist/index.js
```

> Pkg will not resolve dynamic module imports, so avoid these at all costs. (Basically, just use plain ordinary static `import Something from 'somewhere'` and no issue should arise)

> TODO: add `flatted/package.json` patch into npm post-install script

### Troubleshooting

1. **Issue - `pkg .` fails with `[ERR_REQUIRE_ESM]`**

   **Symptom**: error when launching executable:

   ```shell
   Error [ERR_REQUIRE_ESM]: Must use import to load ES Module: C:\snapshot\drill-postman\node_modules\flatted\cjs\index.js
   require() of ES modules is not supported.

   require() of C:\snapshot\drill-postman\node_modules\flatted\cjs\index.js from C:\snapshot\drill-postman\node_modules\uvm\lib\bridge.js is an ES module
   file as it is a .js file whose nearest parent package.json contains "type": "module" which defines all .js files in that package scope as ES modules.
   Instead rename index.js to end in .cjs, change the requiring code to use import(), or remove "type": "module" from C:\snapshot\drill-postman\node_modules\flatted\package.json.
   ```

   **Reason**:
   Pkg is unable to "understand" that when modules is imported with `require()`, it has to utilize `"main": "./cjs/index.js",` to locate CJS module, instead of using `"module": "./esm/index.js"` field to locate ESM module. `"type": "module"` makes it stumble. Removing it from package.json solves the issue

   **Solution**: remove `"type"` and `"module"` fields from the respective package's `package.json` file

   > example: remove the following fields from the `node_modules/flatted/package.json`

   ```json
      "module": "./esm/index.js",
      ...
      "type": "module",
   ```

   > Tip: you can add post-install patch script to automate this process

2. **Issue - Dependency or module is not packaged with executable**

   **Symptom**:

   - either obvious module import error, to the likes of `module not found...`
   - or (in case of missing reporters) warning from newman

   **Reasons(in order)**:

   1. You've forgot to implement/install the module;
   2. Module is implemented/installed, but is not imported "statically", rather its name is resolved in runtime.

      > example:

      ```javascript
         function getModule(name) {
            return require(`path/${name}`)
         }`
      ```

   3. Module is installed, but imported by dependency at runtime (basically, the same reason as 2., but more obscure)

   **Solutions**: either

   - Import module "statically", with `import` or `require()` with literal name

     _or (if it is impossible to import module "statically")_

   - Add dependency to `"assets"` field in `"pkg"` params in [package.json](./package.json)
