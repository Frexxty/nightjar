// afterSign hook: Windows VMP signing, after electron-builder's resource
// editing and (optional) Authenticode signing. See vmp-sign.cjs.
const { vmpSign } = require("./vmp-sign.cjs");

exports.default = (context) => vmpSign(context, "win32");
