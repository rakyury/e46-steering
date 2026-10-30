// Loads the kinematics core (vector helpers … metrics) out of index.html into a bare VM context,
// so the maths can be exercised in Node without a DOM.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const START = "// ───────── vector helpers";
const END = "// ───────── drawing helpers";

function load(file = path.join(__dirname, "..", "index.html")) {
  const html = fs.readFileSync(file, "utf8");
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error("core markers not found in " + file);
  const src = html.slice(a, b) + `
    ;({add,sub,mul,dot,cross,len,nrm,my,DEG,rotvec,HP0,CAR0,DEF,plateFrame,resetP,resetHP,build,pose,residual,solve,
       cpOf,sideMeas,icOf,lineX,rollCenter,ackermann,staticAck,compute,computeCurrent,metrics,
       get P(){return P},set P(v){P=v},get HP(){return HP},get CAR(){return CAR},set CAR(v){CAR=v},get R(){return R}})`;
  const ctx = vm.createContext({ Math, console, document: { querySelector: () => null } });
  return vm.runInContext(src, ctx, { filename: "index.html(core)" });
}

module.exports = { load };
