import program from 'commander';
import fsExtra from 'fs-extra';
import newman, { NewmanRunOptions, NewmanRunSummary } from 'newman';
import adminConnect, { TestInfo, TestResult } from '../admin-connection';
import * as upath from 'upath';
//FIXME remove upath if it won't be used

program
  .description(
    'PWAD - Postman With A Drill' +
      '\n\t' +
      'A thin wrapper over Newman CLI that enables Drill4J metrics collection' +
      '\n\t' +
      'Note that you need to have Drill4J services deployed and agent configured in order for this to work' +
      '\n\t' +
      'See our website for further reference https://drill4j.github.io/' +
      '\n\t' +
      '\n\t' +
      'Simplest example call' +
      '\n\t' +
      'pwad -c my-collection.json --drill-admin-url localhost:8090 --drill-agent-id my-awesome-agent' +
      '\n\t' +
      '\n\t' +
      'Enable HTML reporter example call' +
      '\n\t' +
      'pwad -c my-collection.json --drill-admin-url localhost:8090 --drill-agent-id my-awesome-agent --reporters html' +
      '\n\t' +
      '\n\t' +
      'Launch with env file example call' +
      '\n\t' +
      'pwad -c my-collection.json -e my-env.json --drill-admin-url localhost:8090 --drill-agent-id my-awesome-agent' +
      '\n\t' +
      '\n\t' +
      'Most of Newman CLI parameters are supported via optional .json config supplied with --newman-config-path' +
      '\n\t' +
      'See Postman`s official docs for a further reference' +
      '\n\t' +
      'https://learning.postman.com/docs/running-collections/using-newman-cli/command-line-integration-with-newman/' +
      '\n\t' +
      '\n\t' +
      '"OH NO! My parameter is not supported!" or "I have a custom reporter that does not work!"' +
      '\n\t' +
      'Fear not! Just contact us and we will try to help :)' +
      '\n\t' +
      'Telegram https://t.me/drill4j',
  )
  .requiredOption('-c, --collection-path <collection-path>', 'path to collection.json to run')
  .option('-e, --environment-path <environment-path>', 'path to environment.json')
  .requiredOption('--drill-admin-url <drill-admin-url>', 'Drill4J admin url backend')
  .option('--drill-agent-id <drill-agent-id>', 'Drill4J agent id')
  .option('--drill-group-id <drill-group-id>', 'Drill4J group id')
  .option('--test-type <test-type>', 'Custom test type to display in Drill4J Admin Panel')
  .option(
    '--drill-stop-session-delay <drill-stop-session-delay>',
    'delay time in ms - AFTER all requests are finished and BEFORE stopSession signal is sent to Drill4J',
    '0',
  )
  .option(
    '--test-name-delimiter <test-name-delimiter>',
    'Internal delimiter. Should _not_ be used in test names/paths. Default: \\u2980 - ⦀ - Triple Vertical Bar Delimiter)',
    '\u2980',
  )
  .option('--test-engine-name <test-engine-name>', 'Name passed to Drill4J API "engine" field. Default: Postman', 'Postman')
  .option('--reporters <reporters>', 'comma-separated list of reporters. Available: html, json, junit')
  .option(
    '--newman-config-path <newman-config-path>',
    'path to JSON with run options, such as global vars, reporters, timeouts, etc.' +
      '\n\t' +
      'See https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/newman/index.d.ts for the extensive list' +
      '\n',
  );

program.parse(process.argv);
const options = program.opts();

if (!options.drillAgentId && !options.drillGroupId) {
  throw new Error('Specify either Drill4J agentId or groupId');
}

start();
async function start() {
  const {
    collectionPath,
    environmentPath,
    newmanConfigPath,
    reporters,
    drillAdminUrl,
    drillAgentId,
    drillGroupId,
    drillStopSessionDelay,
    testType,
  } = options;

  console.log('preparing to launch...');
  // prepare postman options
  const collection = await getJsonAtPath(collectionPath);
  let runOptions: NewmanRunOptions = {
    collection,
  };
  if (reporters) {
    runOptions.reporters = reporters.split(',');
  }
  if (environmentPath) {
    const environment = await getJsonAtPath(environmentPath);
    runOptions.environment = environment;
  }
  if (newmanConfigPath) {
    const newmanConfig = await getJsonAtPath(newmanConfigPath);
    runOptions = {
      ...runOptions,
      ...newmanConfig,
    };
  }

  console.log('connecting to drill4j...');
  // connect to Drill4J admin
  const admin = await adminConnect(drillAdminUrl, drillAgentId, drillGroupId);
  const sessionId = await admin.startSession(testType);

  // TODO make patching collection more clear (generic folders/items traverser with a callback to patch data)
  // e.g. traverse(collection, (item, metadata) => ...)
  //  where "item" is the original request item
  //  and "metadata" contains inferred data, such as parent folders names chain

  // patch collection
  //  - set request names to contain parent folder names
  prependFolderNames(collection);
  //  - add d4j headers
  setDrillHeaders(collection, sessionId);

  console.log('launching requests...');
  const runSummary: NewmanRunSummary = await new Promise((resolve, reject) =>
    newman.run(runOptions, (err, summary) => {
      if (err) return reject(err);
      resolve(summary);
    }),
  );

  console.log('requests completed');
  console.log('sending data to Drill4J...');
  // TODO suggest changing backend API to enable sending durations (as an alternative?)
  // HACK to report time for Drill4J
  const finishTime = Date.now();
  // TODO add response.responseTime to NewmanRunExecution type definition
  const tests: TestInfo[] = runSummary.run.executions.map((x: any) => {
    const split = (x.item.name as string).split(options.testNameDelimiter);
    const testName = split.pop();
    const path = split.join('/');
    const name = replaceDelimiterCharacters(x.item.name);
    return {
      id: name, // TODO - build a unique hash from the request object // BLOCKED - backend API send id in headers fix
      name, // will be DEPRECATED in future test2code API versions
      result: convertToDrillTestStatus(x),
      startedAt: x.response?.responseTime ? finishTime - x.response?.responseTime : finishTime, //FIXME
      finishedAt: finishTime,
      details: {
        engine: options.testEngineName,
        path,
        // params: {}, // TODO TDB
        // metadata: {},
        testName,
      },
    };
  });
  await admin.addTests(sessionId, tests);

  const delayMs = parseInt(drillStopSessionDelay);
  if (delayMs) {
    console.log(`waiting ${delayMs}ms to let Drill4J agent to send coverage`);
    await sleep(delayMs);
  }

  await admin.stopSession(sessionId);
  console.log('program finished');
}

async function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function replaceDelimiterCharacters(str) {
  return str.replace(RegExp(options.testNameDelimiter, 'g'), '/');
}

function convertToDrillTestStatus(execution: any): TestResult {
  // prioritize assertions
  const { assertions } = execution;
  if (Array.isArray(assertions)) {
    const isSkipped = assertions.reduce((a, x) => a && x.skipped, true);
    if (isSkipped) return TestResult.SKIPPED;

    const isErrored = assertions.reduce((a, x) => a || x.error, false);
    if (isErrored) return TestResult.FAILED;

    return TestResult.PASSED;
  }

  // use response to generate status only if there are no assertions
  const { response } = execution;
  if (!response) return TestResult.FAILED;

  /*
    1XX, 2XX, 3XX - OK
    4XX, 5XX - fail
    general reference
      https://datatracker.ietf.org/doc/html/rfc7231#section-6
      https://datatracker.ietf.org/doc/html/rfc7231#section-6.1
    additional 511 code
      https://datatracker.ietf.org/doc/html/rfc6585#section-6
  */
  if (response.code >= 100 && response.code < 400) return TestResult.PASSED;
  if (response.code >= 400 && response.code <= 511) return TestResult.FAILED;

  // unexpected HTTP code yields failed test
  console.warn(
    `Response contains unexpected HTTP status code - ${response.code}. Request:\n\t`,
    execution.request.method,
    execution.request.url,
  );
  return TestResult.FAILED;
}

function prependFolderNames(collection) {
  collection.item.forEach(item => traverseChild(item, collection.info.name));
}

function traverseChild(current, parentNameChain) {
  const children = current?.item;
  const isFolder = Array.isArray(children);
  if (isFolder) {
    children.forEach(child => traverseChild(child, parentNameChain + options.testNameDelimiter + current.name));
    return;
  }
  if (!parentNameChain) return;
  current.name = parentNameChain + options.testNameDelimiter + current.name;
}

// NOTE: must be called AFTER requests names are patched
function setDrillHeaders(collection, sessionId) {
  collection.item.forEach(item => traverseChild2(item, sessionId));
}

const DRILL_HEADER_SESSION = 'drill-session-id';
const DRILL_HEADER_TEST_NAME = 'drill-test-name';
function traverseChild2(current, sessionId) {
  const children = current?.item;
  const isFolder = Array.isArray(children);
  if (isFolder) {
    children.forEach(child => traverseChild2(child, sessionId));
    return;
  }
  current.request.header.push({
    key: DRILL_HEADER_SESSION,
    value: sessionId,
    description: '',
  });
  current.request.header.push({
    key: DRILL_HEADER_TEST_NAME,
    value: encodeURIComponent(replaceDelimiterCharacters(current.name)),
    description: '',
  });
}

async function getJsonAtPath(path: string) {
  try {
    return await fsExtra.readJson(path);
  } catch (e) {
    throw new Error(`Failed to read file at path ${path}`);
  }
}
