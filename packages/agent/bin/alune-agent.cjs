#!/usr/bin/env node
require('../dist/cli/main')
  .main()
  .then(
    (code) => {
      process.exit(code);
    },
    (error) => {
      process.stderr.write(`Alune Agent: ${error.message}\n`);
      process.exit(1);
    },
  );
