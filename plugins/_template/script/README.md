Copy this folder to plugins/script-demo. Use the existing data and art references; no game art is included.
Rename the folder id and all script_demo record ids together when making another plugin.
Run `node tools/plugin.mjs check script-demo`, `pack script-demo`, then `test script-demo`.
Testing executes the author's code locally. Serving it also needs SP_PLUGIN_SCRIPTS=trusted, a local listening
address, the lock SHA-256 in plugins/config.json trusted, and every player's consent.
A duration skill and a deployment ATK talent demonstrate the SDK; all numbers are original example design.
