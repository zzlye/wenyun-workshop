import { root, getToolchain, prepareWeb, run } from './toolchain.mjs';
import path from 'node:path';

const tools = await getToolchain();
const { appRoot } = await prepareWeb();
const env = { ...process.env, WENYUN_DESKTOP_WEB_ROOT: path.join(appRoot, 'web') };
delete env.ELECTRON_RUN_AS_NODE;
await run(tools.electron, [root], { env });
