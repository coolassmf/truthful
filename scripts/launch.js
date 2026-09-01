// Cross-platform launcher that strips ELECTRON_RUN_AS_NODE (which, if set in the
// environment, makes the `electron` binary boot as plain Node instead of the app).
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
