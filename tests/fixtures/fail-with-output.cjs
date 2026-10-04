// Writes distinguishable markers to stdout and stderr, then exits non-zero.
// Used to prove execute_command returns the REAL exit code and output for a
// failing command instead of an opaque tool_handler_failure.
process.stdout.write("fail-stdout-marker");
process.stderr.write("fail-stderr-marker");
process.exit(7);
