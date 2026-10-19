#!/usr/bin/env node
import { run } from './run'

run().then(
  () => {
    // A command that reports its own failure, like a refused push, sets the
    // exit code instead of throwing.
    process.exit(process.exitCode ?? 0)
  },
  (error: unknown) => {
    // A message is written for whoever runs the command; the stack only helps
    // when debugging the CLI itself.
    if (error instanceof Error && process.env.ZODIAC_DEBUG == null) {
      console.error(error.message)
    } else if (error) {
      console.error(error)
    }
    process.exit(1)
  }
)
