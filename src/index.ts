#!/usr/bin/env bun

/**
 * Agent Bench CLI Entry Point
 */

import { createCLI } from './cli/index.js';

async function main() {
  try {
    const program = await createCLI();
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
