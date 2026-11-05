// Deliberately separate RC artifact. It has no embedded HTTP backend to fall back to.
process.env.ALUNE_DESKTOP_EXECUTOR='agent';
require('./main.cjs');
